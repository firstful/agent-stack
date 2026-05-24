---
tags:
    - Tutorial
    - MkDocs
    - Github Actions
    - Azure
description: |
    How to host MkDocs sites on Azure Static Web Apps, with built-in auth.
image: https://devblogs.microsoft.com/devops/wp-content/uploads/sites/6/2021/07/SWAlogo2.jpg
---

# Creating Private Documentation with MkDocs and Azure SWA

MkDocs is a fast static site generator for project documentation. Azure Static Web Apps builds and deploys full-stack web apps from a code repository. Together, they make an excellent platform for public and private documentation.

## Why Azure Static Web Apps?

Azure SWA offers several features that make it ideal for documentation sites:

- **Global hosting** with automatic scaling for static content
- **Built-in authentication** via Azure AD, GitHub, or Twitter
- **Custom domains** with automatic SSL
- **Staging environments** for pull requests
- **Integrated CI/CD** from GitHub or Azure DevOps

## Prerequisites

- An existing MkDocs site
- A GitHub repository with your MkDocs source
- An Azure subscription

## Setting Up the Build Configuration

Azure SWA needs a configuration file to know how to build your site. Create `staticwebapp.config.json` in your repository root:

```json
{
  "routes": [
    {
      "route": "/*",
      "serve": "/index.html",
      "statusCode": 200
    }
  ],
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "/images/*"]
  }
}
```

## Authentication for Private Docs

Azure SWA makes private documentation straightforward. Add authentication rules to `staticwebapp.config.json`:

```json
{
  "routes": [
    {
      "route": "/*",
      "allowedRoles": ["authenticated"]
    }
  ]
}
```

This blocks all unauthenticated users. You can also be more granular, allowing anonymous access to specific paths:

```json
{
  "routes": [
    {
      "route": "/public/*",
      "allowedRoles": ["anonymous"]
    },
    {
      "route": "/*",
      "allowedRoles": ["authenticated"]
    }
  ]
}
```

## GitHub Actions Workflow

Azure SWA can generate a workflow automatically when you connect your repository. Here is a manual version:

```yaml
name: Build and Deploy MkDocs

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          pip install -r requirements.txt

      - name: Build site
        run: mkdocs build

      - name: Deploy to Azure SWA
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: upload
          app_location: /site
```

## Custom Domains and SSL

In the Azure portal, navigate to your Static Web App resource and select **Custom domains**. You can add a custom domain and Azure will automatically provision an SSL certificate via Let's Encrypt.

## Summary

Azure SWA provides polished hosting for MkDocs sites with minimal configuration. Built-in authentication makes it ideal for internal documentation that should stay private, without sacrificing ease of setup.
