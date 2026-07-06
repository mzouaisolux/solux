// =====================================================================
// Incoterm-aware Shipping fields — owner req 2026-07-03.
//
// The Shipping form should display only the fields that are meaningful for
// the selected Incoterm, matching real international-trade practice, instead
// of always asking for both a Port of Loading and a Port of Destination.
//
// The app's Incoterm enum is EXW|FOB|CFR|CIF|DDP|DDU (lib/types), but this
// helper handles the wider Incoterms 2020 set defensively so it keeps working
// if the enum grows (FCA / DAP / DPU / CPT / CIP…). Pure + testable.
// =====================================================================

export const DEFAULT_INCOTERM = "FOB";
export const DEFAULT_PORT_OF_LOADING = "Shanghai";

export type IncotermShipping = {
  /** Show the Port of Loading (origin) field. */
  showPortOfLoading: boolean;
  /** Whether the Port of Loading is operationally required for this term. */
  portOfLoadingRequired: boolean;
  /** Field label (varies — e.g. "Delivery / handover location" for FCA). */
  portOfLoadingLabel: string;
  /** Show the Port of Destination field. */
  showPortOfDestination: boolean;
  portOfDestinationLabel: string;
  /** Short contextual hint, or null. */
  note: string | null;
};

const PORT_OF_LOADING = "Port of Loading";
const PORT_OF_DESTINATION = "Port of Destination";

/**
 * Which Shipping fields matter for a given Incoterm.
 *
 *   EXW           → factory pickup: no ports at all.
 *   FCA           → handover at a named place (not necessarily a sea port).
 *   FOB / FAS     → Port of Loading only (buyer arranges onward carriage).
 *   CFR/CIF/CPT/CIP → Port of Loading + Port of Destination.
 *   DAP/DPU/DDP/DDU → destination-driven; Port of Loading optional.
 */
export function shippingFieldsForIncoterm(
  incoterm: string | null | undefined
): IncotermShipping {
  switch ((incoterm ?? "").toUpperCase()) {
    case "EXW":
      return {
        showPortOfLoading: false,
        portOfLoadingRequired: false,
        portOfLoadingLabel: PORT_OF_LOADING,
        showPortOfDestination: false,
        portOfDestinationLabel: PORT_OF_DESTINATION,
        note: "Ex Works — goods are collected at our factory; no port of loading applies.",
      };
    case "FCA":
      return {
        showPortOfLoading: true,
        portOfLoadingRequired: false,
        portOfLoadingLabel: "Delivery / handover location",
        showPortOfDestination: false,
        portOfDestinationLabel: PORT_OF_DESTINATION,
        note: "FCA — goods are handed to the carrier at the named place (not necessarily a sea port).",
      };
    case "FOB":
    case "FAS":
      return {
        showPortOfLoading: true,
        portOfLoadingRequired: true,
        portOfLoadingLabel: PORT_OF_LOADING,
        showPortOfDestination: false,
        portOfDestinationLabel: PORT_OF_DESTINATION,
        note: null,
      };
    case "CFR":
    case "CIF":
    case "CPT":
    case "CIP":
      return {
        showPortOfLoading: true,
        portOfLoadingRequired: true,
        portOfLoadingLabel: PORT_OF_LOADING,
        showPortOfDestination: true,
        portOfDestinationLabel: PORT_OF_DESTINATION,
        note: null,
      };
    case "DAP":
    case "DPU":
    case "DDP":
    case "DDU":
      return {
        showPortOfLoading: true,
        portOfLoadingRequired: false,
        portOfLoadingLabel: PORT_OF_LOADING,
        showPortOfDestination: true,
        portOfDestinationLabel: "Destination / place of delivery",
        note: "Delivered term — the destination is what matters; port of loading is optional.",
      };
    default:
      return {
        showPortOfLoading: true,
        portOfLoadingRequired: false,
        portOfLoadingLabel: PORT_OF_LOADING,
        showPortOfDestination: true,
        portOfDestinationLabel: PORT_OF_DESTINATION,
        note: null,
      };
  }
}
