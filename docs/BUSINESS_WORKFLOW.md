# Business Workflow

## Primary Workflow

```text
Employee
  -> Purchase Request
  -> Manager Approval
  -> Procurement Review
  -> Purchase Order
  -> Goods Receipt
  -> Inventory
  -> Asset Assignment
  -> Reports
  -> Audit
```

## Detailed Flow

1. Employee identifies a procurement need.
2. Employee creates a purchase request with required item, quantity, business justification, urgency, and cost context.
3. System validates request completeness and routes the request to the appropriate manager.
4. Manager reviews business need, budget alignment, urgency, and policy compliance.
5. Manager approves the request.
6. Procurement officer reviews the approved request for supplier, pricing, sourcing strategy, and purchasing compliance.
7. Procurement officer creates a purchase order through the future procurement module.
8. Supplier fulfills the purchase order.
9. Goods receiver records goods receipt, including accepted quantity and exceptions.
10. Inventory is updated for consumable or stock-managed items.
11. Asset manager assigns capital or trackable items to an employee, department, cost center, or location.
12. Reporting views provide operational and management visibility.
13. Audit trail records key decisions, state transitions, and administrative changes.

## Workflow Responsibilities

| Stage | Primary Owner | Outcome |
| --- | --- | --- |
| Employee Request | Employee | Submitted purchase request. |
| Manager Approval | Manager | Approved, rejected, or partially approved request. |
| Procurement Review | Procurement Officer | Request converted to purchasing action or sent for clarification. |
| Purchase Order | Procurement Officer | Purchase order created and issued. |
| Goods Receipt | Goods Receiver | Received quantities recorded. |
| Inventory | Inventory Manager | Stock updated and availability tracked. |
| Asset Assignment | Asset Manager | Asset assigned and accountable owner recorded. |
| Reports | Report Viewer | Process performance and status visibility. |
| Audit | Auditor/Admin | Evidence of actions, decisions, and exceptions. |

## Alternate Flow: Rejected Request

1. Manager reviews the request and determines it should not proceed.
2. Manager provides rejection reason.
3. Request status changes to rejected.
4. Employee receives notification.
5. Request remains visible for audit and historical reporting.
6. Employee may create a new request if business need changes.

Design considerations:

- Rejection must preserve reason, decision maker, and timestamp.
- Rejected requests should not proceed to procurement.
- Rejected requests should remain immutable except for administrative corrections under controlled authorization.

## Alternate Flow: Partial Approval

1. Manager approves only part of the requested quantity, budget, or line scope.
2. System records approved and non-approved portions.
3. Employee is notified about the partial decision.
4. Procurement proceeds only with the approved portion.
5. Non-approved portions remain closed or require a new request depending on policy.

Design considerations:

- Partial approval should not obscure the original request.
- Reporting must distinguish requested, approved, and procured quantities or values.
- Future implementation must define whether partial approval applies at line level, quantity level, amount level, or all of these.

## Alternate Flow: Purchase Order Cancellation

1. Procurement officer identifies that a purchase order must be cancelled.
2. System checks whether goods have already been received.
3. If no goods have been received, the purchase order is cancelled.
4. If goods were partially received, cancellation applies only to remaining open quantities where allowed.
5. Impacted stakeholders are notified.
6. Audit trail records cancellation reason, actor, and timestamp.

Design considerations:

- Cancellation rules must prevent invalid changes after complete receipt.
- Supplier communication and ERP synchronization may be required in future integration phases.

## Alternate Flow: Goods Return

1. Goods receiver or inventory manager identifies damaged, incorrect, or excess goods.
2. Return reason and affected quantity are recorded.
3. Inventory and purchase order receipt status are adjusted according to policy.
4. Procurement coordinates supplier return or replacement.
5. Reports and audit trail reflect return history.

Design considerations:

- Goods return must preserve original receipt reference.
- Returned quantity must not remain available for issue or asset assignment.
- Replacement handling should be treated as a future detailed process design.
