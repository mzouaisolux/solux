import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildForwarderEmail,
  normalizeContainers,
  FORWARDERS,
} from "../lib/forwarder-email.ts";

test("normalizeContainers handles both JSON shapes", () => {
  // transport_requests shape
  assert.deepEqual(
    normalizeContainers([{ container_type: "40HQ", quantity: 2 }]),
    [{ type: "40HQ", quantity: 2 }]
  );
  // packing_list_requests shape
  assert.deepEqual(
    normalizeContainers([{ type: "20GP", quantity: 1 }]),
    [{ type: "20GP", quantity: 1 }]
  );
  // drops empty / zero-qty rows and non-arrays
  assert.deepEqual(normalizeContainers([{ type: "", quantity: 3 }, { type: "40GP", quantity: 0 }]), []);
  assert.deepEqual(normalizeContainers(null), []);
});

test("buildForwarderEmail produces the expected subject + body", () => {
  const { subject, body, forwarder } = buildForwarderEmail(
    {
      projectRef: "SLX-EET-26",
      destinationCountry: "France",
      destinationPort: "Paris",
      incoterm: "FOB",
      transportMode: "sea",
      estimatedShipment: "2026-08-15",
      containers: [
        { container_type: "40HQ", quantity: 2 },
        { container_type: "20GP", quantity: 1 },
      ],
      grossWeightKg: 12500,
      cbm: 68,
    },
    "A"
  );
  assert.equal(forwarder?.label, "Forwarder A");
  assert.equal(subject, "Freight quotation request - Project SLX-EET-26");
  assert.match(body, /Destination: Paris, France \(sea\)/);
  assert.match(body, /Incoterm: FOB/);
  assert.match(body, /Estimated shipment: 2026-08-15/);
  assert.match(body, /Containers: 2 × 40HQ, 1 × 20GP/);
  assert.match(body, /Weight: 12500 kg/);
  assert.match(body, /Volume: 68 CBM/);
  assert.match(body, /Best regards$/);
});

test("buildForwarderEmail degrades gracefully when data is missing", () => {
  const { subject, body } = buildForwarderEmail({ projectRef: null, containers: [] });
  assert.equal(subject, "Freight quotation request - Project —");
  assert.match(body, /Destination: To be confirmed/);
  assert.match(body, /Containers: To be confirmed/);
  assert.match(body, /Weight: To be confirmed/);
  assert.match(body, /Volume: To be confirmed/);
});

test("both forwarders resolve and share content", () => {
  assert.equal(FORWARDERS.length, 2);
  const a = buildForwarderEmail({ projectRef: "X", containers: [] }, "A");
  const b = buildForwarderEmail({ projectRef: "X", containers: [] }, "B");
  assert.equal(a.body, b.body); // same content for now
  assert.equal(a.forwarder?.key, "A");
  assert.equal(b.forwarder?.key, "B");
});
