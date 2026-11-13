import type { Metadata } from "next";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { redirect } from "next/navigation";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure, formaterNombre } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import {
  apercuNumero,
  BASE_RETENUE_LIBELLES,
  BASE_RETENUE_LIBELLES_EN,
  droitsParametresFacturation,
  mentionsManquantes,
  type ParametresFacturation,
} from "../../../../lib/parametres-facturation";
import { obtenirSession } from "../../../../lib/session";
import { FormulaireIdentite, FormulaireOperationnel } from "./FormulairesFacturation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Paramètres de facturation", "Billing settings") };
}

const NBSP = " ";
const pct = (n: number, langue: Langue) =>
  langue === "en" ? formaterNombre(n, 4, langue) + "%" : formaterNombre(n, 4) + NBSP + "%";

export default async function PageParametresFacturation() {
  const { utilisateur } = await obtenirSession();
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const droits = droitsParametresFacturation(utilisateur.roles);
  if (!droits.identite && !droits.operationnel) redirect("/acces-refuse");
  const r = await chargerServeur<ParametresFacturation>("/api/parametres-facturation");
  const annee = new Date().getUTCFullYear();

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Facturation", "Billing")}
        soustitre={t(
          "Mentions légales, coordonnées de paiement, numérotation, TVA et retenues appliquées aux factures du cabinet (FIN-07).",
          "Legal mentions, payment details, numbering, VAT and withholdings applied to the firm's invoices (FIN-07).",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les paramètres de facturation n'ont pas pu être chargés.",
            "The billing settings could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/parametres/facturation"
        />
      ) : (
        <ContenuParametres p={r.donnees} droits={droits} annee={annee} langue={langue} />
      )}
    </div>
  );
}

function ContenuParametres({
  p,
  droits,
  annee,
  langue,
}: {
  p: ParametresFacturation;
  droits: ReturnType<typeof droitsParametresFacturation>;
  annee: number;
  langue: Langue;
}) {
  const t = creerTraduire(langue);
  const manquantes = mentionsManquantes(p, langue);
  return (
    <>
      {!p.valeurs_validees ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t(
            "Valeurs de départ à valider par le métier",
            "Starting values to be approved by the business",
          )}
        >
          <p>
            {t(
              "TVA à 18 % (Côte d'Ivoire), retenue à la source désactivée et délai de 30 jours sont des valeurs de départ. Faites-les vérifier par votre expert-comptable, puis cochez « Valeurs validées par le métier ».",
              'VAT at 18% (Côte d\'Ivoire), withholding disabled and a 30-day term are starting values. Have them checked by your chartered accountant, then tick "Values approved by the business".',
            )}
          </p>
        </Alerte>
      ) : null}
      {manquantes.length > 0 ? (
        <Alerte
          tonalite="info"
          annonce="aucune"
          titre={t(
            "Mentions à compléter avant toute émission",
            "Mentions to complete before any issuance",
          )}
        >
          <p>
            {t(
              `Une facture ne peut pas être émise sans : ${manquantes.join(", ")}.`,
              `An invoice cannot be issued without: ${manquantes.join(", ")}.`,
            )}
          </p>
        </Alerte>
      ) : null}
      <Carte
        titre={t(
          "Mentions légales, coordonnées et numérotation",
          "Legal mentions, details and numbering",
        )}
      >
        {droits.identite ? (
          <FormulaireIdentite parametres={p} annee={annee} />
        ) : (
          <IdentiteLecture p={p} annee={annee} langue={langue} />
        )}
      </Carte>
      <Carte titre={t("TVA, retenue et délai de paiement", "VAT, withholding and payment term")}>
        {droits.operationnel ? (
          <FormulaireOperationnel parametres={p} />
        ) : (
          <dl className="mp-liste-def">
            <div>
              <dt>{t("TVA", "VAT")}</dt>
              <dd>
                {t(
                  `${pct(p.taux_tva_defaut, langue)} par défaut ; débours ${pct(p.taux_tva_debours, langue)}`,
                  `${pct(p.taux_tva_defaut, langue)} by default; expenses ${pct(p.taux_tva_debours, langue)}`,
                )}
              </dd>
            </div>
            <div>
              <dt>{t("Retenue", "Withholding")}</dt>
              <dd>
                {p.retenue_active
                  ? t(
                      `${p.retenue_libelle} : ${pct(p.retenue_taux, langue)} sur ${BASE_RETENUE_LIBELLES[p.retenue_base]}`,
                      `${p.retenue_libelle}: ${pct(p.retenue_taux, langue)} on ${BASE_RETENUE_LIBELLES_EN[p.retenue_base]}`,
                    )
                  : t("Désactivée", "Disabled")}
              </dd>
            </div>
            <div>
              <dt>{t("Délai de paiement", "Payment term")}</dt>
              <dd>{t(`${p.delai_paiement_jours} jours`, `${p.delai_paiement_jours} days`)}</dd>
            </div>
          </dl>
        )}
      </Carte>
      {p.modifie_le ? (
        <p className="mp-texte-petit mp-texte-doux">
          {t("Dernière modification le", "Last modified on")}{" "}
          {formaterDateHeure(p.modifie_le, undefined, langue)}.
        </p>
      ) : null}
    </>
  );
}

function IdentiteLecture({
  p,
  annee,
  langue,
}: {
  p: ParametresFacturation;
  annee: number;
  langue: Langue;
}) {
  const t = creerTraduire(langue);
  const lignes: [string, string | null][] = [
    [t("Raison sociale", "Company name"), p.raison_sociale],
    [t("Forme juridique", "Legal form"), p.forme_juridique],
    [t("Numéro RCCM", "RCCM number"), p.rccm],
    [t("Compte contribuable", "Taxpayer account number"), p.compte_contribuable],
    [t("Régime fiscal", "Tax regime"), p.regime_fiscal],
    [t("Adresse", "Address"), p.adresse],
    [t("Banque", "Bank"), p.banque],
    [p.iban_masque ? t("IBAN (masqué)", "IBAN (masked)") : "IBAN", p.iban],
    [
      t("Numérotation", "Numbering"),
      t(
        `Format : ${apercuNumero(p.prefixe_facture, p.chiffres_numero, annee)}`,
        `Format: ${apercuNumero(p.prefixe_facture, p.chiffres_numero, annee)}`,
      ),
    ],
  ];
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">
        {t(
          "Modifiables par un associé (gestion du cabinet).",
          "Editable by a partner (firm management).",
        )}
      </p>
      <dl className="mp-liste-def">
        {lignes.map(([dt, dd]) => (
          <div key={dt}>
            <dt>{dt}</dt>
            <dd className="mp-texte-preserve">{dd ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
