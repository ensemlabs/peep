# GEMINI=1 joins the external llm-proxy network (free dev/test provider, see docs/dev/llm-proxy.md).
GEMINI ?= 0
COMPOSE_FILES = -f docker-compose.yml
ifeq ($(GEMINI),1)
COMPOSE_FILES += -f docker-compose.gemini.yml
endif
COMPOSE = docker compose $(COMPOSE_FILES)
# e2e always runs against the llm-proxy dev provider plus the e2e overrides.
COMPOSE_E2E = docker compose -f docker-compose.yml -f docker-compose.gemini.yml -f docker-compose.e2e.yml

.PHONY: help env up down logs ps build test-be test-fe e2e e2e-down clean

help:            ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

env:             ## Create .env and config/models.yaml from the examples (if missing)
	@test -f .env || cp .env.example .env
	@test -f config/models.yaml || cp config/models.example.yaml config/models.yaml

up: env          ## Start the stack in the background (build if needed)
	$(COMPOSE) up -d --build

down:            ## Stop the stack
	$(COMPOSE) down

logs:            ## Follow service logs
	$(COMPOSE) logs -f

ps:              ## Show running services
	$(COMPOSE) ps

build:           ## Build all service images
	$(COMPOSE) build

test-be: env     ## Run backend tests (real Postgres + MinIO in compose)
	$(COMPOSE) --profile test run --rm --build api-test

test-fe:         ## Run frontend unit tests + type check/build in a node container
	docker run --rm -u $$(id -u):$$(id -g) -v "$$PWD/frontend":/app -w /app -e HOME=/tmp node:24.15.0-alpine sh -c "npm ci && npm test && npm run build"

e2e: env         ## Run the Playwright suite against the live stack (ARGS="--grep @gemini" to filter)
	$(COMPOSE_E2E) up -d --build
	@port=$$(grep -E '^WEB_PORT=' .env | cut -d= -f2); port=$${port:-8090}; \
	for i in $$(seq 1 60); do curl -fs -o /dev/null "http://127.0.0.1:$$port/api/health" && break; sleep 2; done; \
	curl -fs -o /dev/null "http://127.0.0.1:$$port/api/health" || { echo "web did not become ready"; false; }
	@rc=0; \
	E2E_UID=$$(id -u) E2E_GID=$$(id -g) $(COMPOSE_E2E) --profile e2e run --rm e2e $(ARGS) || rc=$$?; \
	sh e2e/check-db.sh $(COMPOSE_E2E) || { echo "A3 DB check failed"; rc=1; }; \
	test $$rc -eq 0

e2e-down:        ## Stop the stack started by `make e2e`
	$(COMPOSE_E2E) --profile e2e down

clean:           ## Stop the stack and delete volumes (destroys local data)
	$(COMPOSE) down -v
