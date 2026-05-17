# Make.com Companion Scenario

Make.com is used to show a visual automation scenario alongside n8n.

## Intended Flow

- Trigger: webhook receives a new job payload
- Parse the payload
- Call the backend scoring endpoint
- Store or update the CRM record
- Send a formatted notification

## Purpose

Make.com is useful for demonstrating visual workflow construction and comparing it with the more code-first n8n approach.
