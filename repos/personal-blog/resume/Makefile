SHELL := /bin/bash
ROOT  := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: all build build-variant build-ts list clean check check-all install-deps help

all: build

build: install-deps build-ts
	python $(ROOT)scripts/build.py

build-variant: install-deps build-ts
	@if [ -z "$(V)" ]; then echo "Usage: make V=<variant> build-variant"; exit 1; fi
	python $(ROOT)scripts/build.py --variant "$(V)"

build-ts:
	@python $(ROOT)scripts/build-ts.py 2>/dev/null || echo "  (ts build skipped — install npm deps with: cd resume/ts && npm install)"

build-no-pdf: install-deps
	python $(ROOT)scripts/build.py --no-pdf

list:
	python $(ROOT)scripts/build.py --list

check:
	python $(ROOT)scripts/ats_check.py

check-all: build
	@for pdf in $(ROOT)output/*/resume.pdf; do \
		echo "=== $$pdf ==="; \
		python $(ROOT)scripts/ats_check.py "$$pdf"; \
	done

clean:
	rm -rf $(ROOT)build $(ROOT)output

install-deps:
	@pip install -q pyyaml jinja2 2>/dev/null || true

help:
	@echo "Usage:"
	@echo "  make build                 Build all variants + TS (default)"
	@echo "  make V=swe build-variant   Build a single variant (e.g. V=agentic-engineer)"
	@echo "  make build-ts              Compile TypeScript -> JS"
	@echo "  make build-no-pdf          Generate .tex only (skip pdflatex)"
	@echo "  make check                 Interactively pick a PDF to ATS-check"
	@echo "  make check-all             ATS-check all built PDFs"
	@echo "  make list                  List available variants"
	@echo "  make clean                 Remove build/, output/, and ts/node_modules/"
