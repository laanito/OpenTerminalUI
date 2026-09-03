SHELL := /bin/bash

.PHONY: setup setup-backend setup-frontend test test-backend build build-frontend check-surface gate

setup: setup-backend setup-frontend

setup-backend:
	cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && pip install pytest

setup-frontend:
	cd frontend && npm install

test: test-backend

test-backend:
	cd backend && source .venv/bin/activate && python -m compileall . && pytest -q

build: build-frontend

build-frontend:
	cd frontend && npm run build

check-surface:
	PYTHONPATH=. backend/.venv/bin/python scripts/check_surface_inventory.py

gate: check-surface test-backend build-frontend
