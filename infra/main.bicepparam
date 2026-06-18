using './main.bicep'

// Non-secret defaults — safe to commit. Match the live topology (RG `projects`).
param appLocation = 'mexicocentral'
param platformLocation = 'eastus'
param namePrefix = 'jobops'
param planSku = 'B1'
param nodeLinuxFxVersion = 'NODE|22-lts'
param agentImage = 'ca9ee6437892acr.azurecr.io/jobops-agent:latest'
param postgresSkuName = 'Standard_B1ms'
param postgresTier = 'Burstable'
param postgresAdminUser = 'jobopsadmin'
param llmProvider = 'openai'

// Default false: never reconcile the existing production `jobops` Postgres server.
// Set true (and supply postgresAdminPassword) only for a greenfield environment.
param createPostgres = false

// Secrets — leave blank here and pass at deploy time (NEVER commit real values):
//   az deployment group create -g projects -f infra/main.bicep -p infra/main.bicepparam \
//     -p databaseUrl="$DATABASE_URL" openAiApiKey=$OPENAI_API_KEY
// Or, preferred: reference Azure Key Vault (jobops-kv) secrets (see infra/README.md).
param postgresAdminPassword = ''
param databaseUrl = ''
param anthropicApiKey = ''
param openAiApiKey = ''
param googleGeminiApiKey = ''
