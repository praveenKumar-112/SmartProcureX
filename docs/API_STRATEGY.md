# API Strategy

This document defines API principles only. It does not define concrete endpoints, CAP services, or payload schemas.

## REST Conventions

SmartProcureX APIs should follow predictable REST-style conventions where applicable and remain aligned with SAP CAP service design.

Principles:

- Use resource-oriented naming.
- Use nouns for resources, not verbs.
- Use standard HTTP methods for operation intent.
- Keep request and response contracts consistent.
- Avoid exposing internal database structure directly.
- Use pagination, filtering, sorting, and search for list-style resources.
- Use action-style operations only when the business operation does not map cleanly to a standard resource update.

## Versioning Strategy

Recommended strategy:

- Start with version `v1` for externally consumed APIs when public stability is required.
- Keep internal UI-to-CAP APIs stable within each release.
- Avoid breaking changes inside an active major version.
- Introduce a new major version for incompatible changes.
- Document deprecation timelines before removing contracts.

Versioning principles:

- Version at the service/API boundary, not per field.
- Maintain compatibility for SAPUI5 portals during phased deployments.
- Keep reporting APIs versioned separately if their consumers differ from transactional APIs.

## Naming Conventions

General API naming:

- Use lowercase resource paths.
- Use hyphenated words for multi-word URL segments.
- Use clear business language instead of technical abbreviations.
- Use consistent status and type value naming.

Payload naming:

- Prefer clear property names aligned with business terminology.
- Use consistent timestamp naming.
- Use consistent identifier naming.
- Avoid leaking persistence-specific names unless they are part of the public contract.

Service naming:

- Name CAP services by business capability.
- Keep administration and reporting services separate from transactional services.
- Avoid large all-purpose services.

## Error Handling

Error responses should be consistent across modules.

Expected error attributes:

- Machine-readable error code.
- Human-readable message.
- Optional target field or operation.
- Optional correlation identifier.
- Optional details for validation failures.

Error handling principles:

- Do not expose technical stack traces to clients.
- Return validation errors before performing state-changing operations.
- Log technical details server-side.
- Preserve correlation IDs for support and audit.
- Use localized messages where business users are the target audience.

## Status Codes

Use standard HTTP status codes consistently:

| Status | Usage |
| --- | --- |
| `200 OK` | Successful read or update with response body. |
| `201 Created` | Successful creation of a new resource. |
| `202 Accepted` | Request accepted for asynchronous processing. |
| `204 No Content` | Successful operation with no response body. |
| `400 Bad Request` | Invalid request structure or business validation failure. |
| `401 Unauthorized` | Missing or invalid authentication. |
| `403 Forbidden` | Authenticated user lacks required authorization. |
| `404 Not Found` | Resource does not exist or is not visible to the user. |
| `409 Conflict` | State conflict, duplicate business key, or invalid transition. |
| `422 Unprocessable Entity` | Semantically valid request with process-level validation issues, if adopted consistently. |
| `500 Internal Server Error` | Unexpected server-side failure. |

## Security Principles

Security must be enforced in the backend, not only in the UI.

Principles:

- Use enterprise identity provider integration in a future authentication phase.
- Apply role-based access control.
- Enforce least privilege.
- Validate object-level authorization, not only application role access.
- Protect administrative APIs separately.
- Log security-relevant events.
- Use secure transport for all communication.
- Avoid sensitive data exposure in logs, errors, and browser-visible payloads.
- Plan CSRF protection and secure session/token handling according to the selected SAP BTP authentication architecture.
