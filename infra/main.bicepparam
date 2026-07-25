using './main.bicep'

// Non-secret defaults — safe to commit. Match the live topology (RG `projects`,
// reconciled 2026-07-25). Config params whose main.bicep defaults already match live
// (corsAllowedOrigins, adzunaCountry, aiDailyBudgetUsd, timeouts, openAiModel,
// langfuseHost, langfusePublicKey, acrUsername) are intentionally omitted here.
param appLocation = 'mexicocentral'
param platformLocation = 'eastus'
param namePrefix = 'jobops'
param planSku = 'B1'
param nodeLinuxFxVersion = 'NODE|22-lts'

// The agent image is published + pinned by the container pipeline; a deploy either
// passes the current tag or lets the pipeline manage it. `latest` here is a placeholder
// and will show as a diff in what-if against the live pinned SHA (expected).
param agentImage = 'ca9ee6437892acr.azurecr.io/jobops-agent:latest'

// Non-secret, browser-exposed identifiers (safe to commit).
param clerkPublishableKey = 'pk_test_Zmxvd2luZy1iZWFnbGUtOTMuY2xlcmsuYWNjb3VudHMuZGV2JA'
param adzunaAppId = '620bd9be'

// Default false: never reconcile the existing production `jobops` Postgres server.
// Set true (and supply postgresAdminPassword) only for a greenfield environment.
param createPostgres = false

// ---- Secrets — leave blank here; supply at deploy time (NEVER commit real values) ----
// App Service DATABASE_URL / CLERK_SECRET_KEY are Key Vault references (jobops-kv), so no
// value is needed for them. Every secret below is REPLACE-on-deploy: a blank value blanks
// the live secret. Supply via env-sourced overrides, e.g.:
//   az deployment group create -g projects -f infra/main.bicep -p infra/main.bicepparam \
//     -p databaseUrl="$DATABASE_URL" agentApiKey="$AGENT_API_KEY" openAiApiKey="$OPENAI_API_KEY" \
//        tavilyApiKey="$TAVILY_API_KEY" langfuseSecretKey="$LANGFUSE_SECRET_KEY" \
//        n8nWebhookSecret="$N8N_WEBHOOK_SECRET" adzunaAppKey="$ADZUNA_APP_KEY" \
//        acrAdminPassword="$ACR_ADMIN_PASSWORD"
// Always `what-if` first.
param databaseUrl = ''
param agentApiKey = ''
param n8nWebhookSecret = ''
param adzunaAppKey = ''
param openAiApiKey = ''
param tavilyApiKey = ''
param langfuseSecretKey = ''
param acrAdminPassword = ''
param postgresAdminPassword = ''
