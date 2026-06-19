// JobOps Copilot — infrastructure as code (Phase 5 · T).
//
// Models the ACTUAL deployed topology (verified 2026-06-18 against RG `projects`):
//   - App Service plan (B1, Linux) + jobops-web / jobops-api (Node 22)   — mexicocentral
//   - Postgres Flexible Server 16 (pgvector), opt-in                       — mexicocentral
//   - Log Analytics + workspace-based Application Insights                 — eastus
//   - Key Vault                                                           — eastus
//   - Container Apps managed environment + jobops-agent (container)       — eastus
// Resources legitimately span two regions, so locations are split across params.
//
// Validate (no deploy):  az bicep build --file infra/main.bicep
// Preview vs live:        az deployment group what-if -g projects -f infra/main.bicep -p infra/main.bicepparam
// Deploy:                 az deployment group create  -g projects -f infra/main.bicep -p infra/main.bicepparam
//
// NOTE: desired-state model. Run `what-if` first — the agent's ACR + image are built/pushed
// by the container pipeline (`az containerapp up` / a deploy workflow), not this template;
// `agentImage` just points the container app at an already-published tag.

@description('Region for the App Service tier + Postgres (web/api/plan/db).')
param appLocation string = 'mexicocentral'

@description('Region for the platform tier (observability, Key Vault, the agent container app).')
param platformLocation string = 'eastus'

@description('Base name; every resource name derives from it.')
param namePrefix string = 'jobops'

@description('Linux App Service plan SKU. B1 ~1.75GB RAM.')
param planSku string = 'B1'

@description('Node runtime for the web + api App Services.')
param nodeLinuxFxVersion string = 'NODE|22-lts'

@description('Container image for the agent (built + pushed by the container pipeline).')
param agentImage string = 'ca9ee6437892acr.azurecr.io/jobops-agent:latest'

@description('''Create the Postgres Flexible Server. Default false so a deploy never reconciles
the EXISTING production server (`jobops`). Set true only for a greenfield environment.''')
param createPostgres bool = false

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
@description('Postgres administrator password (required only when createPostgres is true).')
param postgresAdminPassword string = ''

@secure()
@description('Full DATABASE_URL connection string injected into the API + agent.')
param databaseUrl string = ''

@secure()
@description('''Server-to-server shared secret authenticating the API->agent hop (QA·A).
Set on the API as AGENT_API_KEY and on the agent as a container secret; when blank the
agent leaves auth disabled. Generate with e.g. `openssl rand -hex 32`.''')
param agentApiKey string = ''

@description('Agent LLM provider: anthropic | openai | azure_openai | google_genai.')
param llmProvider string = 'openai'

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
var keyVaultName = '${namePrefix}-kv'
var agentEnvName = '${namePrefix}-agent-env'
var postgresName = namePrefix

var webHost = 'https://${webAppName}.azurewebsites.net'
var apiHost = 'https://${apiAppName}.azurewebsites.net'

// ---- Observability (eastus) ------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: platformLocation
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: platformLocation
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: platformLocation
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    // soft delete is on-by-default and non-disableable for this API version.
  }
}

// ---- App Service tier (mexicocentral) --------------------------------------

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: appLocation
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
  location: appLocation
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: nodeLinuxFxVersion
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
      ]
    }
  }
}

resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: apiAppName
  location: appLocation
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: nodeLinuxFxVersion
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AGENT_SERVICE_URL'
          value: 'https://${agentApp.properties.configuration.ingress.fqdn}'
        }
        {
          // Plain app setting from a @secure() param (App Service encrypts settings at
          // rest), matching how databaseUrl is injected below. The agent side uses a
          // proper Container App secret (configuration.secrets). Promote to a Key Vault
          // reference if the API control-plane threat model warrants it.
          name: 'AGENT_API_KEY'
          value: agentApiKey
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

// ---- Agent: Container App (eastus) -----------------------------------------

resource agentEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: agentEnvName
  location: platformLocation
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource agentApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: agentAppName
  location: platformLocation
  properties: {
    managedEnvironmentId: agentEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
      }
      // Server-to-server shared secret (QA·A): the agent is internet-facing (the API
      // reaches it across regions over this FQDN), so every request must carry it.
      secrets: [
        {
          name: 'agent-api-key'
          value: agentApiKey
        }
      ]
      // ACR pull auth (registries/identity) is configured by the container pipeline.
    }
    template: {
      containers: [
        {
          name: 'agent'
          image: agentImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'AGENT_API_KEY'
              secretRef: 'agent-api-key'
            }
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
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
      }
    }
  }
}

// ---- Postgres Flexible Server (mexicocentral, opt-in) ----------------------

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = if (createPostgres) {
  name: postgresName
  location: appLocation
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

// Allow-list the pgvector extension (RAG vector store, migration 003). Lowercase
// `vector` to match scripts/azure/provision.sh and the Azure extension name.
resource postgresVector 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = if (createPostgres) {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'vector'
    source: 'user-override'
  }
}

// Let Azure-hosted services (the App Service apps) reach Postgres.
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (createPostgres) {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output webUrl string = webHost
output apiUrl string = apiHost
output agentUrl string = 'https://${agentApp.properties.configuration.ingress.fqdn}'
output postgresFqdn string = postgres.?properties.fullyQualifiedDomainName ?? ''
