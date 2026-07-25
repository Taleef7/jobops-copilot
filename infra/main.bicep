// JobOps Copilot — infrastructure as code (Phase 5 · T; reconciled 2026-07-25).
//
// Models the ACTUAL deployed topology (verified 2026-07-25 against RG `projects`):
//   - App Service plan (B1, Linux) + jobops-web / jobops-api (Node 22)   — mexicocentral
//   - Postgres Flexible Server 16 (pgvector), opt-in                       — mexicocentral
//   - Log Analytics + workspace-based Application Insights                 — eastus
//   - Key Vault (jobops-kv, RBAC)                                          — eastus
//   - Container Apps managed environment + jobops-agent (container)        — eastus
// Resources legitimately span two regions, so locations are split across params.
//
// This template now models live reality FAITHFULLY (a `what-if` shows no setting/secret
// deletions): every app setting, the Key Vault references (DATABASE_URL / CLERK_SECRET_KEY
// via each app's system-assigned identity + a Key Vault Secrets User role assignment), and
// the agent's real secrets/env/registry/resources. See docs below for the deploy contract.
//
// Validate (no deploy):  az bicep build --file infra/main.bicep
// Preview vs live:        az deployment group what-if -g projects -f infra/main.bicep -p infra/main.bicepparam
// Deploy:                 az deployment group create  -g projects -f infra/main.bicep -p infra/main.bicepparam
//
// DEPLOY SAFETY — App Service `appSettings` and Container App `secrets` are REPLACE, not
// merge: a blank @secure() param blanks the live value. The KV-backed secrets (DATABASE_URL,
// CLERK_SECRET_KEY) are references — no value flows through the template, so they can't be
// blanked. Every OTHER secret below is a @secure() param that MUST be supplied at deploy
// (sourced from env in main.bicepparam); otherwise you will overwrite a live secret with "".
// Always `what-if` first.
//
// NOTE: desired-state model. The agent's ACR + image are built/pushed by the container
// pipeline (`az containerapp up` / a deploy workflow), not this template; `agentImage`
// just points the container app at an already-published tag.

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

// ---- Non-secret app configuration (live values as defaults) ----------------

@description('Clerk publishable key — non-secret; ships to the browser (NEXT_PUBLIC_*).')
param clerkPublishableKey string = ''

@description('CORS allow-list for the API (comma-separated origins).')
param corsAllowedOrigins string = 'https://jobops-web.azurewebsites.net'

@description('Adzuna job-search app id (paired with the secret app key).')
param adzunaAppId string = ''

@description('Adzuna country code for job search.')
param adzunaCountry string = 'us'

@description('Per-tenant AI spend cap (USD/day) enforced by the API budget guard.')
param aiDailyBudgetUsd string = '1.00'

@description('API-to-agent per-request timeout (ms).')
param agentTimeoutMs string = '90000'

@description('API→agent long-running task timeout (ms).')
param agentTaskTimeoutMs string = '180000'

@description('Agent LLM provider: anthropic | openai | azure_openai | google_genai.')
param llmProvider string = 'openai'

@description('Agent OpenAI model id.')
param openAiModel string = 'gpt-5.4-nano'

@description('Langfuse public key — non-secret (paired with the secret key).')
param langfusePublicKey string = ''

@description('Langfuse ingestion host.')
param langfuseHost string = 'https://us.cloud.langfuse.com'

@description('ACR admin username for the agent registry pull (admin creds, per live).')
param acrUsername string = 'ca9ee6437892acr'

// ---- Secrets (supply at deploy; NEVER commit real values) ------------------
// KV-backed on App Service (DATABASE_URL, CLERK_SECRET_KEY) so no value flows through
// the template; the rest are literal secrets the deploy must provide.

@secure()
@description('''Full DATABASE_URL. Feeds the agent's `database-url` Container App secret.
On App Service it is resolved via a Key Vault reference (jobops-kv/DATABASE-URL), so the
App Service side needs no value here.''')
param databaseUrl string = ''

@secure()
@description('''Server-to-server shared secret for the API->agent hop (QA·A). One value,
set on the API as AGENT_API_KEY and on the agent as the `agent-api-key` secret. Blank
disables agent auth — never deploy blank against prod. Generate: `openssl rand -hex 32`.''')
param agentApiKey string = ''

@secure()
@description('n8n inbound webhook shared secret (API N8N_WEBHOOK_SECRET).')
param n8nWebhookSecret string = ''

@secure()
@description('Adzuna job-search app key.')
param adzunaAppKey string = ''

@secure()
@description('OpenAI API key (agent `openai-key` secret).')
param openAiApiKey string = ''

@secure()
@description('Tavily web-search API key (agent `tavily-api-key` secret).')
param tavilyApiKey string = ''

@secure()
@description('Langfuse secret key (agent `langfuse-secret-key` secret).')
param langfuseSecretKey string = ''

@secure()
@description('ACR admin password for the agent registry pull (agent registry passwordSecretRef).')
param acrAdminPassword string = ''

// ---- Postgres (opt-in) -----------------------------------------------------

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

// Built-in role: Key Vault Secrets User (read secret values via RBAC).
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

// App Service Key Vault references — the app resolves these at runtime via its
// system-assigned identity, so no secret value flows through this template.
var databaseUrlKvRef = '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/DATABASE-URL)'
var clerkSecretKeyKvRef = '@Microsoft.KeyVault(SecretUri=${keyVault.properties.vaultUri}secrets/CLERK-SECRET-KEY)'

var acrLoginServer = split(agentImage, '/')[0]

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
  // System-assigned identity resolves the CLERK_SECRET_KEY Key Vault reference.
  identity: {
    type: 'SystemAssigned'
  }
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
          name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'
          value: clerkPublishableKey
        }
        {
          name: 'CLERK_SECRET_KEY'
          value: clerkSecretKeyKvRef
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
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
  location: appLocation
  // System-assigned identity resolves the DATABASE_URL + CLERK_SECRET_KEY KV references.
  identity: {
    type: 'SystemAssigned'
  }
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
          // rest). Same shared secret the agent holds as the `agent-api-key` secret.
          name: 'AGENT_API_KEY'
          value: agentApiKey
        }
        {
          name: 'AGENT_TIMEOUT_MS'
          value: agentTimeoutMs
        }
        {
          name: 'AGENT_TASK_TIMEOUT_MS'
          value: agentTaskTimeoutMs
        }
        {
          name: 'API_PUBLIC_BASE_URL'
          value: apiHost
        }
        {
          name: 'DATABASE_URL'
          value: databaseUrlKvRef
        }
        {
          name: 'CLERK_PUBLISHABLE_KEY'
          value: clerkPublishableKey
        }
        {
          name: 'CLERK_SECRET_KEY'
          value: clerkSecretKeyKvRef
        }
        {
          name: 'CORS_ALLOWED_ORIGINS'
          value: corsAllowedOrigins
        }
        {
          name: 'AI_DAILY_BUDGET_USD'
          value: aiDailyBudgetUsd
        }
        {
          name: 'ADZUNA_APP_ID'
          value: adzunaAppId
        }
        {
          name: 'ADZUNA_APP_KEY'
          value: adzunaAppKey
        }
        {
          name: 'ADZUNA_COUNTRY'
          value: adzunaCountry
        }
        {
          name: 'N8N_WEBHOOK_SECRET'
          value: n8nWebhookSecret
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'WEBSITE_HTTPLOGGING_RETENTION_DAYS'
          value: '3'
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

// Grant each app's identity read access to the vault's secrets (RBAC), so the
// Key Vault references above resolve. Deterministic GUIDs → idempotent re-assert.
resource webKvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, kvSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource apiKvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apiApp.id, kvSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: apiApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalType: 'ServicePrincipal'
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
      // The agent is internet-facing (the API reaches it across regions over this FQDN),
      // so every request must carry the shared secret. NOTE: a secret value change does
      // NOT auto-roll running revisions — after rotating, restart/roll a revision so the
      // agent reloads it (see docs/AZURE_DEPLOYMENT.md "Rotating the key later").
      secrets: [
        {
          name: 'agent-api-key'
          value: agentApiKey
        }
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'openai-key'
          value: openAiApiKey
        }
        {
          name: 'tavily-api-key'
          value: tavilyApiKey
        }
        {
          name: 'langfuse-secret-key'
          value: langfuseSecretKey
        }
        {
          // ACR admin-credential pull secret (live uses admin creds, not a managed identity).
          name: 'ca9ee6437892acrazurecrio-ca9ee6437892acr'
          value: acrAdminPassword
        }
      ]
      registries: [
        {
          server: acrLoginServer
          username: acrUsername
          passwordSecretRef: 'ca9ee6437892acrazurecrio-ca9ee6437892acr'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'agent'
          image: agentImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'LLM_PROVIDER'
              value: llmProvider
            }
            {
              name: 'OPENAI_MODEL'
              value: openAiModel
            }
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-key'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsights.properties.ConnectionString
            }
            {
              name: 'LANGFUSE_PUBLIC_KEY'
              value: langfusePublicKey
            }
            {
              name: 'LANGFUSE_HOST'
              value: langfuseHost
            }
            {
              name: 'LANGFUSE_SECRET_KEY'
              secretRef: 'langfuse-secret-key'
            }
            {
              name: 'TAVILY_API_KEY'
              secretRef: 'tavily-api-key'
            }
            {
              name: 'AGENT_API_KEY'
              secretRef: 'agent-api-key'
            }
          ]
          // Liveness/readiness on the agent's /health (the app exposes it). Live has no
          // probes today, so this is the one intentional improvement in this reconcile —
          // a hung container gets recycled and traffic waits for readiness.
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              initialDelaySeconds: 5
              periodSeconds: 10
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
