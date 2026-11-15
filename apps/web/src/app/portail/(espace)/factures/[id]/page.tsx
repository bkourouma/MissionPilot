import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import {
  designationFacturePortail,
  estIdentifiant,
  etatPaiement,
  hrefDocumentFacture,
  montantPortail,
  peut,
  type FacturePortail,
} from "../../../../../lib/portail";
import { CHEMIN_PORTAIL } from "../../../../../lib/portail-routes";
import type { Langue, Traduire } from "@missionpilot/shared";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Facture", "Invoice") };
}

const CHEMIN_FACTURES = `${CHEMIN_PORTAIL}/factures`;

function Totaux({ f, t, langue }: { f: FacturePortail; t: Traduire; langue: Langue }) {
  const m = (v: number) => montantPortail(v, f.devise, langue);
  return (
    <dl className="mp-totaux-facture">
      <div>
        <dt>{t("Total hors taxes", "Total excluding tax")}</dt>
        <dd>{m(f.total_ht)}</dd>
      </div>
      <div>
        <dt>{t("TVA", "VAT")}</dt>
        <dd>{m(f.total_tva)}</dd>
      </div>
      <div className="mp-totaux-facture__fort">
        <dt>{t("Total toutes taxes comprises", "Total including tax")}</dt>
        <dd>{m(f.total_ttc)}</dd>
      </div>
      {f.total_retenues !== 0 ? (
        <div>
          <dt>{t("Retenues déduites", "Withholdings deducted")}</dt>
          <dd>{m(f.total_retenues)}</dd>
        </div>
      ) : null}
      <div className="mp-totaux-facture__net">
        <dt>
          {f.nature === "avoir"
            ? t("Montant de l'avoir", "Credit note amount")
            : t("Net à payer", "Net payable")}
        </dt>
        <dd>{m(f.net_a_payer)}</dd>
      </div>
    </dl>
  );
}

function Paiement({ f, t, langue }: { f: FacturePortail; t: Traduire; langue: Langue }) {
  if (!f.paiement) return null;
  const m = (v: number) => montantPortail(v, f.devise, langue);
  return (
    <dl className="mp-portail-paiement">
      <div>
        <dt>{t("Déjà réglé", "Already paid")}</dt>
        <dd>{m(f.paiement.encaisse)}</dd>
      </div>
      <div>
        <dt>{t("Reste à payer", "Remaining to pay")}</dt>
        <dd>{m(f.paiement.solde)}</dd>
      </div>
    </dl>
  );
}

/** Détail d'une facture émise : totaux, paiement et document imprimable. */
export default async function FacturePortailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.factures.lire"))
    return <NonDisponible titre={t("Facture", "Invoice")} />;
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();

  const r = await chargerPortail<FacturePortail>(`/api/portail/factures/${encodeURIComponent(id)}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Facture", "Invoice")}
          retour={{ href: CHEMIN_FACTURES, libelle: t("Vos factures", "Your invoices") }}
        />
        <EtatErreur
          titre={t("Cette facture n'a pas pu être chargée.", "This invoice could not be loaded.")}
          message={r.message}
          hrefReessayer={`${CHEMIN_FACTURES}/${id}`}
        />
      </div>
    );
  }

  const f = r.donnees;
  const paiement = etatPaiement(f, langue);
  const missionVisible = peut(utilisateur.roles, "portail.missions.lire");

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={designationFacturePortail(f, langue)}
        retour={{ href: CHEMIN_FACTURES, libelle: t("Vos factures", "Your invoices") }}
        badges={<BadgeStatut tonalite={paiement.tonalite}>{paiement.libelle}</BadgeStatut>}
        soustitre={f.objet ?? undefined}
        actions={
          <a
            href={hrefDocumentFacture(f.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={classesBouton("primaire")}
          >
            <Icone nom="oeil" />
            <span>{t("Afficher la facture", "View the invoice")}</span>
            <span className="mp-visuellement-cache"> {t("(nouvel onglet)", "(new tab)")}</span>
          </a>
        }
      />

      <Carte titre={t("Informations", "Information")}>
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>{t("Mission", "Engagement")}</dt>
            <dd>
              {missionVisible ? (
                <Link href={`${CHEMIN_PORTAIL}/missions/${encodeURIComponent(f.mission.id)}`}>
                  {f.mission.intitule}
                </Link>
              ) : (
                f.mission.intitule
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Date d'émission", "Issue date")}</dt>
            <dd>{formaterDate(f.date_emission, "UTC", langue)}</dd>
          </div>
          {f.date_echeance ? (
            <div>
              <dt>{t("Date d'échéance", "Due date")}</dt>
              <dd>{formaterDate(f.date_echeance, "UTC", langue)}</dd>
            </div>
          ) : null}
          {f.nature === "avoir" && f.facture_origine_id ? (
            <div>
              <dt>{t("Facture concernée", "Related invoice")}</dt>
              <dd>
                <Link href={`${CHEMIN_FACTURES}/${encodeURIComponent(f.facture_origine_id)}`}>
                  {t(
                    "Voir la facture annulée par cet avoir",
                    "View the invoice cancelled by this credit note",
                  )}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <Carte titre={t("Montants", "Amounts")}>
        <Totaux f={f} t={t} langue={langue} />
      </Carte>

      {f.paiement ? (
        <Carte titre={t("Paiement", "Payment")}>
          <Paiement f={f} t={t} langue={langue} />
          <p className="mp-portail-note">
            {t(
              "Le suivi des règlements est tenu par votre cabinet. Un paiement récent peut mettre quelques jours à apparaître.",
              "Payments are tracked by your firm. A recent payment may take a few days to appear.",
            )}
          </p>
        </Carte>
      ) : null}

      <p className="mp-portail-note">
        {t(
          "Le document de la facture s'ouvre dans un nouvel onglet : vous pouvez l'imprimer ou l'enregistrer en PDF depuis votre navigateur.",
          "The invoice document opens in a new tab: you can print it or save it as a PDF from your browser.",
        )}
      </p>
    </div>
  );
}
