// JobOps Copilot — infrastructure as code (Phase 5 · T).
//
// Codifies the Azure footprint that scripts/azure/provision.sh creates imperatively:
// a Linux App Service plan hosting three apps (web/api/agent), a workspace-based
// Application Insights, and a Postgres Flexible Server with the pgvector extension
// allow-listed. Resource-group scoped — create the RG first, then deploy here.
//
// Validate (no Azure login needed):   az bicep build --file infra/main.bicep
// Preview against a subscription:      az deployment group what-if -g <rg> -f infra/main.bicep -p infra/main.bicepparam
// Deploy:                              az deployment group create  -g <rg> -f infra/main.bicep -p infra/main.bicepparam
//
// NOTE: this models desired state. Against an existing deployment, ALWAYS run
// `what-if` first — applying a fresh Postgres password/SKU can be disruptive.

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Base name; every resource name derives from it.')
param namePrefix string = 'jobops'

@description('Linux App Service plan SKU. B1 ~1.75GB RAM; bump for RAG/torch on the agent.')
param planSku string = 'B1'

@description('Postgres Flexible Server compute SKU.')
param postgresSkuName string = 'Standard_B1ms'

@description('Postgres Flexible Server tier.')
@allowed([
  'Burstable'
  'GeneralPurpose'
  'MemoryOptimized'
])
param postgresTier string = 'Burstable'

@description('Postgres administrator login.')
param postgresAdminUser string = 'jobopsadmin'

@secure()
@description('Postgres administrator password (required at deploy time).')
param postgresAdminPassword string = ''

@secure()
@description('Full DATABASE_URL connection string injected into the API + agent apps.')
param databaseUrl string = ''

@description('Agent LLM provider: anthropic | openai | azure_openai | google_genai.')
param llmProvider string = ''

@secure()
param anthropicApiKey string = ''

@secure()
param openAiApiKey string = ''

@secure()
param googleGeminiApiKey string = ''

var webAppName = '${namePrefix}-web'
var apiAppName = '${namePrefix}-api'
var agentAppName = '${namePrefix}-agent'
var planName = '${namePrefix}-plan'
var logAnalyticsName = '${namePrefix}-logs'
var appInsightsName = '${namePrefix}-insights'
var postgresName = namePrefix

var webHost = 'https://${webAppName}.azurewebsites.net'
var apiHost = 'https://${apiAppName}.azurewebsites.net'
var agentHost = 'https://${agentAppName}.azurewebsites.net'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: planSku
  }
  properties: {
    reserved: true // Linux
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'NEXT_PUBLIC_API_BASE_URL'
          value: apiHost
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
      ]
    }
  }
}

resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: apiAppName
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AGENT_SERVICE_URL'
          value: agentHost
        }
        {
          name: 'API_PUBLIC_BASE_URL'
          value: apiHost
        }
        {
          name: 'DATABASE_URL'
          value: databaseUrl
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          // WEBSITE_RUN_FROM_PACKAGE=1 mounts the deploy package read-only,
          // avoiding the B1 big-node_modules extraction hang (see deploy-api.yml).
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
      ]
    }
  }
}

resource agentApp 'Microsoft.Web/sites@2023-12-01' = {
  name: agentAppName
  location: location
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      // Code-deploy path (no-RAG agent). For full RAG/torch, deploy the container
      // from services/agent/Dockerfile instead (App Service for Containers / ACA).
      linuxFxVersion: 'PYTHON|3.12'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'LLM_PROVIDER'
          value: llmProvider
        }
        {
          name: 'ANTHROPIC_API_KEY'
          value: anthropicApiKey
        }
        {
          name: 'OPENAI_API_KEY'
          value: openAiApiKey
        }
        {
          name: 'GOOGLE_GEMINI_API_KEY'
          value: googleGeminiApiKey
        }
        {
          name: 'DATABASE_URL'
          value: databaseUrl
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: postgresName
  location: location
  sku: {
    name: postgresSkuName
    tier: postgresTier
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

// Allow-list the pgvector extension (RAG vector store, migration 003).
resource postgresVector 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'VECTOR'
    source: 'user-override'
  }
}

// Let Azure-hosted services (the App Service apps) reach Postgres.
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output webUrl string = webHost
output apiUrl string = apiHost
output agentUrl string = agentHost
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
