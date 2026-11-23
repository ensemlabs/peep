# GEMINI=1 (default) also joins the external llm-proxy network; use GEMINI=0 when it is not running.
GEMINI ?= 1
COMPOSE_FILES = -f docker-compose.yml
ifeq ($(GEMINI),1)
COMPOSE_FILES += -f docker-compose.gemini.yml
endif
COMPOSE = docker compose $(COMPOSE_FILES)

.PHONY: help env up down logs ps build test-be test-fe clean

help:            ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

env:             ## Create .env from .env.example (if missing)
	@test -f .env || cp .env.example .env

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

# e2e target is added by a later step.

clean:           ## Stop the stack and delete volumes (destroys local data)
	$(COMPOSE) down -v
