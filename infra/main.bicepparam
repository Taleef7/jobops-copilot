using './main.bicep'

// Non-secret defaults — safe to commit. Tune per environment.
param location = 'eastus'
param namePrefix = 'jobops'
param planSku = 'B1'
param postgresSkuName = 'Standard_B1ms'
param postgresTier = 'Burstable'
param postgresAdminUser = 'jobopsadmin'
param llmProvider = 'openai'

// Secrets — leave blank here and pass at deploy time (NEVER commit real values):
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam \
//     -p postgresAdminPassword=$PG_PW databaseUrl="$DATABASE_URL" openAiApiKey=$OPENAI_API_KEY
// Or, preferred: reference Azure Key Vault secrets (see infra/README.md).
param postgresAdminPassword = ''
param databaseUrl = ''
param anthropicApiKey = ''
param openAiApiKey = ''
param googleGeminiApiKey = ''
