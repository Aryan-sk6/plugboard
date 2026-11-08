---
name: inventory
description: Keep a simple list of the products you stock, update how many you have, and get a reorder list when things run low.
---

# Inventory tracking

Help a small shop keep track of its stock.

## Keep the stock list

For each product, remember:

- Product name (required)
- How many are in stock now (a number, required)
- Reorder when it drops to (a number)
- Supplier
- Cost per unit (a number)

Saving a product with the same name again should update its numbers instead of adding a second copy, so the owner can type in
a new count after a delivery or a stock check. The owner should be able to see the whole stock list.

## What should I reorder?

Look at every saved product. List the ones where the number in stock is at or below its reorder level, as a table with these
columns: Product, In stock, Reorder level, Suggested order, Supplier, Estimated cost.
Suggest ordering enough to get back to twice the reorder level, and estimate the cost as suggested order × cost per unit.
The owner can optionally say how many weeks of stock they want to cover; mention it in the note if given.
If nothing needs reordering, say so in the note and return an empty table. Only use the saved products; do not invent any.
