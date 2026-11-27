# Arc VRF: everyday commands. Run `make help` for the list.
SHELL := /bin/bash
export PATH := $(HOME)/.foundry/bin:$(PATH)

.PHONY: help install keys deploy-contracts up down logs health update test

help: ## Show commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-18s %s\n", $$1, $$2}'

install: ## Install JS dependencies
	pnpm install

keys: ## Create .env with fresh keys and print the addresses to fund
	pnpm --filter @arc-vrf/node new-keys

deploy-contracts: ## Deploy contracts to the chain in RPC_URL using .env (needs Foundry)
	@command -v forge >/dev/null || { echo "forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup"; exit 1; }
	@[ -f contracts/lib/forge-std/src/Test.sol ] || git submodule update --init --recursive
	cd contracts && forge build
	set -a && . ./.env && set +a && pnpm --filter @arc-vrf/node deploy-contracts

up: ## Build and start web + vrf-node
	docker compose up -d --build

down: ## Stop everything
	docker compose down

logs: ## Follow logs from both services
	docker compose logs -f --tail=100

health: ## Show web and node health
	@docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
	@docker compose exec -T vrf-node node -e "fetch('http://127.0.0.1:8080').then(r=>r.text()).then(console.log)"

update: ## Pull the latest code and redeploy
	git pull --ff-only && $(MAKE) up

test: ## Contract tests, node tests, web tests and build
	cd contracts && forge test --ffi
	pnpm --filter @arc-vrf/node test
	pnpm --filter web test
	pnpm --filter web build
