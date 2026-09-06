SHELL := /bin/bash

.PHONY: setup setup-backend setup-frontend test test-backend test-frontend build build-frontend check-mocks check-surface gate

setup: setup-backend setup-frontend

setup-backend:
	cd backend && python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt

setup-frontend:
	cd frontend && npm ci

test: test-backend test-frontend

test-backend:
	PYTHONPATH=. backend/.venv/bin/python -m compileall -x 'backend/\.venv' backend
	PYTHONPATH=. backend/.venv/bin/python -m pytest backend/tests -q --cov=backend --cov-fail-under=45

test-frontend:
	cd frontend && npm test

build: build-frontend

build-frontend:
	cd frontend && npm run build

check-surface:
	PYTHONPATH=. backend/.venv/bin/python scripts/check_surface_inventory.py

check-mocks:
	backend/.venv/bin/python scripts/check_no_production_mocks.py

gate: check-mocks check-surface test-backend build-frontend test-frontend
