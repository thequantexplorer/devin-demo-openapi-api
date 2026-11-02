# Devin demo: Build an API from an OpenAPI spec

**What it shows:** Devin reads an OpenAPI spec, writes the handlers with Zod validation, and adds Supertest tests for every response code in the spec. The PR has a table that maps each response code to the test that covers it.

**Needs:** GitHub only

More demos: [devin-advanced-demos](https://github.com/thequantexplorer/devin-advanced-demos)

## The starting problem

`openapi/bookings.yaml` describes three endpoints: create, list and cancel bookings. The handlers in `src/routes/bookings.ts` only return `501 Not Implemented`, so the contract test fails:

```text
 ❯ test/contract.test.ts (4 tests | 3 failed)
   × ... 'post' '/bookings' ('createBooking') returns a documented status
     → createBooking returned 501: {"error":{"code":"not_implemented",...}}: expected [ '201', '400', '404', '409', '422' ] to include '501'
   × ... 'get' '/bookings' ('listBookings') returns a documented status
     → listBookings returned 501: ...: expected [ '200', '400' ] to include '501'
   × ... 'post' '/bookings/{bookingId}/cancel' ('cancelBooking') returns a documented status
     → cancelBooking returned 501: ...: expected [ '200', '400', '404', '409', '422' ] to include '501'
 ✓ test/health.test.ts (1 test)

      Tests  3 failed | 2 passed (5)
```

You can see the same failure in your copy's **Actions** tab: the **CI** run on `main` is red.

## Set it up

1. Click **Use this template → Create a new repository**, choose your GitHub account or org as the owner, and keep the name `devin-demo-openapi-api`. The prompt below assumes that name. Use the template rather than a fork: pull requests on a fork go to the original repo by default.
2. In Devin, open [**Settings → Connections → GitHub**](https://app.devin.ai/settings/connections/github) and make sure Devin can access the new repository.

## Prompt

Start a new Devin session at [app.devin.ai](https://app.devin.ai) and paste this. Replace `<you>` with your GitHub user or org.

```text
Implement the bookings API in https://github.com/<you>/devin-demo-openapi-api so it matches openapi/bookings.yaml exactly.

Write the three handlers in src/routes/bookings.ts: createBooking, listBookings and cancelBooking. Validate the body, query and path params with Zod. Return the error shape, error codes and check order that the spec describes, including invalid JSON.

Write Supertest tests that cover every response code of every operation in the spec, and every 400, 404, 409 and 422 rule. Use createApp({ clock }) with a fixed clock so the tests never depend on the real time. Run npm run typecheck and npm test until both pass, including test/contract.test.ts.

Open a PR. In the description, add a table with one row per operation and response code: the rule it checks and the test that covers it. Also list anything in the spec you found unclear and what you decided.
```

## What to watch

- Devin reads `openapi/bookings.yaml` first and works from its rules, not from guesses.
- The tests use a fixed clock, so they pass on any day.
- CI on the PR turns green.

## Done when

- `npm test` passes, including `test/contract.test.ts`.
- Every response code in the spec (201, 200, 400, 404, 409, 422) has at least one test.
- The PR has the response-code table.
