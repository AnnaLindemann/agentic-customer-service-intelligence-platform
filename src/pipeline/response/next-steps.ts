/**
 * Next-step business guidance — deterministic, grounded, bilingual (improvement set, ADR-014).
 *
 * Every automated outcome should leave the customer knowing the next business action. This module
 * computes that next step *deterministically* from the structured business facts, the rule results
 * and company policy — never from the LLM and never inventing promotions, discounts, delivery
 * guarantees or unsupported promises (ADR-001). The same lines are used two ways:
 *
 *   - fed into the Response Generator prompt as the authoritative "next step" the draft must
 *     convey, so a generated email stays grounded; and
 *   - assembled directly into the deterministic fallback reply when no compliant draft exists.
 *
 * Output is plain text in the customer's detected language (`de` | `en`). Amounts, dates, SKUs and
 * statuses are business data (not PII); customer names / e-mails / addresses are never used here.
 */
import { Decision, Workflow } from '../../domain';
import type { BusinessRuleResult, ReasonCode, StructuredSource } from '../../types';
import type { EscalationCategory } from '../decision/escalation-triggers';
import type { OutOfScopeCategory } from '../decision/out-of-scope';
import type { Language } from './language';

/** Fictional storefront base for the prototype's product links. */
const PRODUCT_URL_BASE = 'https://example.com/products';
/** Fictional careers page for out-of-scope job/career redirects. */
export const CAREERS_URL = 'https://example.com/careers';
/** Fictional business-contact page for out-of-scope supplier/partnership redirects. */
export const CONTACT_URL = 'https://example.com/contact';

export interface NextStepInput {
  decision: Decision;
  workflow: Workflow;
  language: Language;
  reasonCode: ReasonCode;
  structuredFacts: StructuredSource[];
  ruleResults?: BusinessRuleResult[];
  missingInformation: string[];
  caseReference?: string;
  /** True when every business rule passed (e.g. an eligible cancellation). */
  actionEligible?: boolean;
  escalationCategory?: EscalationCategory;
  /** Out-of-scope subtype; selects the correct redirect (careers / business contact / none). */
  outOfScopeCategory?: OutOfScopeCategory;
  /** Product-resolution status (product-availability workflow) for the not-found/ambiguous replies. */
  productResolution?: 'resolved' | 'ambiguous' | 'underspecified' | 'not_found';
  /** The product name the customer asked about (for the not-found / clarification messages). */
  productQuery?: string;
  /** Candidate product names when the request was ambiguous. */
  productCandidates?: string[];
}

function fact(facts: StructuredSource[], kind: StructuredSource['kind']) {
  return facts.find((f) => f.kind === kind)?.data;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function money(value: unknown, currency: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  const cur = typeof currency === 'string' ? currency : 'USD';
  return `${value.toFixed(2)} ${cur}`;
}

/** The alternative identifiers we can accept when an order cannot be located. */
function alternativeIdentifiers(language: Language): string {
  return language === 'de'
    ? 'Ihren Namen, die bei der Bestellung verwendete E-Mail-Adresse, das ungefähre Kaufdatum oder den Produktnamen'
    : 'your name, the e-mail address used for the purchase, the approximate purchase date, or the product name';
}

/**
 * Build the grounded next-step lines for a decided case, in the customer's language. Returns an
 * empty array when no specific next step applies (the caller still produces a complete reply).
 */
export function buildNextSteps(input: NextStepInput): string[] {
  const de = input.language === 'de';

  if (input.decision === Decision.OUT_OF_SCOPE) {
    const scopeLineDe =
      'Dieses Postfach bearbeitet ausschließlich Kundenservice-Anfragen zu Bestellungen, Rechnungen, Stornierungen, beschädigten Artikeln und Produktverfügbarkeit.';
    const scopeLineEn =
      'This mailbox handles customer-service requests only — orders, invoices, cancellations, damaged items and product availability.';
    switch (input.outOfScopeCategory) {
      case 'career':
        return de
          ? [scopeLineDe, `Für Bewerbungen und Karrierethemen besuchen Sie bitte unsere Karriereseite: ${CAREERS_URL}`]
          : [scopeLineEn, `For job applications and careers, please visit our careers page: ${CAREERS_URL}`];
      case 'b2b':
        return de
          ? [scopeLineDe, `Für Anfragen zu Lieferantenbeziehungen oder Partnerschaften wenden Sie sich bitte an unser Geschäftskunden-Team: ${CONTACT_URL}`]
          : [scopeLineEn, `For supplier or partnership enquiries, please contact our business team: ${CONTACT_URL}`];
      default:
        // "other" — politely explain the scope without sending the customer to the wrong channel.
        return de
          ? [scopeLineDe, 'Bitte wenden Sie sich mit einem entsprechenden Anliegen erneut an uns; bei anderen Themen können wir an dieser Stelle leider nicht weiterhelfen.']
          : [scopeLineEn, 'Please get back to us with a request of that kind; for other topics we are unfortunately not the right contact here.'];
    }
  }

  if (input.decision === Decision.HUMAN_ESCALATION) {
    return de
      ? ['Eine Kundenservice-Mitarbeiterin oder ein Kundenservice-Mitarbeiter prüft Ihr Anliegen und meldet sich persönlich bei Ihnen. Sie müssen dafür nichts weiter tun.']
      : ['A customer-service agent will review your request and follow up with you personally. You do not need to do anything further.'];
  }

  if (input.decision === Decision.ASK_FOR_MORE_INFORMATION) {
    // Product clarifications take precedence over the order-identifier ask.
    if (input.workflow === Workflow.PRODUCT_AVAILABILITY && input.productResolution) {
      return productClarificationSteps(input, de);
    }
    const notFound = input.reasonCode === 'STRUCTURED_DATA_MISSING';
    if (notFound) {
      return de
        ? [
            'Zu der angegebenen Bestellnummer konnten wir leider keine Bestellung finden.',
            `Bitte prüfen Sie die Nummer noch einmal oder senden Sie uns alternativ ${alternativeIdentifiers('de')}, damit wir Ihre Bestellung zuordnen können.`,
          ]
        : [
            'We could not find an order for the number you provided.',
            `Please double-check the number, or alternatively send us ${alternativeIdentifiers('en')} so we can locate your order.`,
          ];
    }
    // Required identifier missing (the customer may not know the order number).
    return de
      ? [
          'Damit wir Ihr Anliegen bearbeiten können, benötigen wir noch eine Angabe zu Ihrer Bestellung.',
          `Falls Ihnen die Bestellnummer nicht vorliegt, genügt auch ${alternativeIdentifiers('de')}.`,
        ]
      : [
          'To process your request we need one more detail about your order.',
          `If you do not have the order number to hand, ${alternativeIdentifiers('en')} is also fine.`,
        ];
  }

  // AUTO_REPLY — grounded, business-oriented next step per workflow.
  if (input.decision === Decision.AUTO_REPLY) {
    switch (input.workflow) {
      case Workflow.PRODUCT_AVAILABILITY:
        return input.productResolution === 'not_found'
          ? productNotFoundSteps(input, de)
          : productNextSteps(input, de);
      case Workflow.CANCELLATION:
        return input.actionEligible
          ? de
            ? [
                'Ihre Bestellung wurde storniert. Es wird keine Zahlung eingezogen; eine bereits autorisierte Zahlung wird nicht belastet.',
                'Falls bereits eine Zahlung erfolgt ist, erhalten Sie die Erstattung in der Regel innerhalb von 5 bis 10 Werktagen auf Ihr ursprüngliches Zahlungsmittel; eine Bestätigung senden wir Ihnen, sobald die Erstattung veranlasst wurde.',
              ]
            : [
                'Ihre Bestellung wurde storniert. Eine bereits autorisierte Zahlung wird nicht belastet.',
                'Sollte bereits eine Zahlung erfolgt sein, wird diese als Erstattung bearbeitet; eine Bestätigung folgt.',
              ]
          : de
            ? [
                'Ihre Bestellung wurde bereits versandt und kann daher nicht mehr storniert werden.',
                'Sobald die Lieferung bei Ihnen eingetroffen ist, können Sie die Artikel im Rahmen unserer Rückgaberichtlinie innerhalb von 30 Tagen zurücksenden.',
              ]
            : [
                'Your order has already shipped, so it can no longer be cancelled.',
                'Once it arrives, you can return the items within 30 days under our return policy.',
              ];
      case Workflow.DAMAGED_ITEM:
        return damagedNextSteps(input, de);
      case Workflow.INVOICE:
        return invoiceNextSteps(input, de);
      default:
        return [];
    }
  }

  return [];
}

/** A specific product was named but the catalogue has no such item (deterministic PRODUCT_NOT_FOUND). */
function productNotFoundSteps(input: NextStepInput, de: boolean): string[] {
  const name = input.productQuery?.trim();
  const named = name ? (de ? `„${name}"` : `'${name}'`) : de ? 'das genannte Produkt' : 'that product';
  return de
    ? [
        `Leider konnten wir ${named} nicht in unserem Sortiment finden.`,
        'Falls Sie ein anderes Produkt gemeint haben, senden Sie uns bitte die genaue Produktbezeichnung oder die Artikelnummer (SKU), dann prüfen wir die Verfügbarkeit gerne erneut.',
      ]
    : [
        `Unfortunately we could not find ${named} in our catalogue.`,
        'If you intended a different product, please send us the exact product name or SKU and we will gladly check availability again.',
      ];
}

/** The product request was ambiguous or too generic — ask the customer to narrow it down. */
function productClarificationSteps(input: NextStepInput, de: boolean): string[] {
  if (input.productResolution === 'ambiguous') {
    const list = (input.productCandidates ?? []).join(de ? ', ' : ', ');
    return de
      ? [
          `Zu Ihrer Anfrage passen mehrere Produkte aus unserem Sortiment${list ? `: ${list}` : ''}.`,
          'Welches dieser Produkte meinen Sie? Bitte nennen Sie die genaue Bezeichnung oder die Artikelnummer (SKU).',
        ]
      : [
          `Several products in our catalogue match your request${list ? `: ${list}` : ''}.`,
          'Which one do you mean? Please reply with the exact product name or the SKU.',
        ];
  }
  // underspecified (a generic category)
  return de
    ? [
        'Ihre Anfrage bezieht sich auf eine ganze Produktkategorie.',
        'Damit wir die Verfügbarkeit prüfen können, nennen Sie uns bitte das konkrete Produkt (genaue Bezeichnung oder Artikelnummer/SKU).',
      ]
    : [
        'Your request refers to a whole product category.',
        'So we can check availability, please tell us the specific product (exact name or SKU).',
      ];
}

function productNextSteps(input: NextStepInput, de: boolean): string[] {
  const product = fact(input.structuredFacts, 'product');
  const sku = product && str(product.sku);
  const availability = product && str(product.availability);
  const qty = product && typeof product.quantityOnHand === 'number' ? product.quantityOnHand : undefined;
  const restock = product && str(product.restockDate);
  const url = sku ? `${PRODUCT_URL_BASE}/${sku}` : undefined;

  const orderable = availability === 'in_stock' || availability === 'low_stock' || availability === 'backordered';
  const lines: string[] = [];

  if (availability === 'low_stock') {
    lines.push(
      de
        ? `Der Artikel ist aktuell auf Lager, der Bestand ist jedoch begrenzt${qty !== undefined ? ` (noch ${qty} Stück verfügbar)` : ''}.`
        : `The item is currently in stock, though stock is limited${qty !== undefined ? ` (${qty} left)` : ''}.`,
    );
  } else if (availability === 'in_stock') {
    lines.push(de ? 'Der Artikel ist auf Lager und sofort lieferbar.' : 'The item is in stock and ready to ship.');
  } else if (availability === 'backordered') {
    lines.push(
      de
        ? `Der Artikel ist derzeit im Rückstand${restock ? ` und voraussichtlich ab ${restock} wieder verfügbar` : ''}; eine Vorbestellung ist möglich.`
        : `The item is currently backordered${restock ? ` and expected back from ${restock}` : ''}; you can pre-order it.`,
    );
  } else if (availability === 'out_of_stock') {
    lines.push(
      de
        ? `Der Artikel ist zurzeit nicht auf Lager${restock ? ` und voraussichtlich ab ${restock} wieder verfügbar` : ''}.`
        : `The item is currently out of stock${restock ? ` and expected back from ${restock}` : ''}.`,
    );
  } else if (availability === 'discontinued') {
    lines.push(
      de
        ? 'Der Artikel wurde aus dem Sortiment genommen und ist nicht mehr bestellbar.'
        : 'The item has been discontinued and is no longer available to order.',
    );
  }

  if (orderable && url) {
    lines.push(
      de
        ? `Sie können den Artikel hier ansehen oder bestellen:\n${url}`
        : `You can view or order the item here:\n${url}`,
    );
  }
  return lines;
}

function damagedNextSteps(input: NextStepInput, de: boolean): string[] {
  const ref = input.caseReference;
  return de
    ? [
        `Es tut uns leid, dass Ihr Artikel beschädigt angekommen ist. Wir haben hierfür einen Vorgang angelegt${ref ? ` (Referenz ${ref})` : ''}.`,
        'Bitte antworten Sie auf diese E-Mail und fügen Sie einige Fotos des beschädigten Artikels sowie der Verpackung und eine kurze Beschreibung des Schadens bei.',
        'Nach Eingang prüfen wir die Unterlagen und veranlassen – sofern berechtigt – einen kostenfreien Ersatz oder eine Erstattung. Wir melden uns dann mit den nächsten Schritten.',
      ]
    : [
        `We are sorry your item arrived damaged. We have opened a case for you${ref ? ` (reference ${ref})` : ''}.`,
        'Please reply to this e-mail and attach a few photos of the damaged item and its packaging, along with a short description of the damage.',
        'Once we receive them we will review the case and, where eligible, arrange a free replacement or a refund, then follow up with the next steps.',
      ];
}

function invoiceNextSteps(input: NextStepInput, de: boolean): string[] {
  const invoice = fact(input.structuredFacts, 'invoice');
  const status = invoice && str(invoice.status);
  const amountDue = invoice && money(invoice.amountDue, invoice.currency);
  const dueDate = invoice && str(invoice.dueDate);

  if (status === 'unpaid' || status === 'overdue' || status === 'partially_paid') {
    const overdue = status === 'overdue';
    return de
      ? [
          `Ihre Rechnung weist den Status „${status}" auf${amountDue ? `; offen sind derzeit ${amountDue}` : ''}.`,
          overdue
            ? 'Die Zahlung ist überfällig. Bitte begleichen Sie den offenen Betrag zeitnah, um weitere Schritte zu vermeiden.'
            : `Bitte begleichen Sie den offenen Betrag${dueDate ? ` bis zum ${dueDate}` : ' bis zum Fälligkeitsdatum'}. Akzeptiert werden Kreditkarte, PayPal und Banküberweisung.`,
        ]
      : [
          `Your invoice has the status "${status}"${amountDue ? `; ${amountDue} is currently outstanding` : ''}.`,
          overdue
            ? 'The payment is overdue. Please settle the outstanding amount soon to avoid further steps.'
            : `Please settle the outstanding amount${dueDate ? ` by ${dueDate}` : ' by the due date'}. We accept credit card, PayPal and bank transfer.`,
        ];
  }
  if (status === 'paid') {
    return de
      ? ['Ihre Rechnung ist vollständig bezahlt; es ist nichts weiter zu tun.']
      : ['Your invoice is paid in full; there is nothing further to do.'];
  }
  if (status === 'refunded' || status === 'voided') {
    return de
      ? [`Ihre Rechnung wurde ${status === 'refunded' ? 'vollständig erstattet' : 'storniert'}; es besteht keine offene Forderung.`]
      : [`Your invoice has been ${status === 'refunded' ? 'fully refunded' : 'voided'}; nothing is outstanding.`];
  }
  return [];
}
