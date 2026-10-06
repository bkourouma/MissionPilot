import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure, formaterNombre } from "../../../../lib/format";
import {
  apercuNumero,
  BASE_RETENUE_LIBELLES,
  droitsParametresFacturation,
  mentionsManquantes,
  type ParametresFacturation,
} from "../../../../lib/parametres-facturation";
import { obtenirSession } from "../../../../lib/session";
import { FormulaireIdentite, FormulaireOperationnel } from "./FormulairesFacturation";

export const metadata: Metadata = { title: "Paramètres de facturation" };

const NBSP = " ";
const pct = (n: number) => formaterNombre(n, 4) + NBSP + "%";

export default async function PageParametresFacturation() {
  const { utilisateur } = await obtenirSession();
  const droits = droitsParametresFacturation(utilisateur.roles);
  if (!droits.identite && !droits.operationnel) redirect("/acces-refuse");
  const r = await chargerServeur<ParametresFacturation>("/api/parametres-facturation");
  const annee = new Date().getUTCFullYear();

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Facturation"
        soustitre="Mentions légales, coordonnées de paiement, numérotation, TVA et retenues appliquées aux factures du cabinet (FIN-07)."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les paramètres de facturation n'ont pas pu être chargés."
          message={r.message}
          hrefReessayer="/parametres/facturation"
        />
      ) : (
        <ContenuParametres p={r.donnees} droits={droits} annee={annee} />
      )}
    </div>
  );
}

function ContenuParametres({
  p,
  droits,
  annee,
}: {
  p: ParametresFacturation;
  droits: ReturnType<typeof droitsParametresFacturation>;
  annee: number;
}) {
  const manquantes = mentionsManquantes(p);
  return (
    <>
      {!p.valeurs_validees ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre="Valeurs de départ à valider par le métier"
        >
          <p>
            TVA à 18 % (Côte d&apos;Ivoire), retenue à la source désactivée et délai de 30 jours
            sont des valeurs de départ. Faites-les vérifier par votre expert-comptable, puis cochez
            « Valeurs validées par le métier ».
          </p>
        </Alerte>
      ) : null}
      {manquantes.length > 0 ? (
        <Alerte tonalite="info" annonce="aucune" titre="Mentions à compléter avant toute émission">
          <p>{`Une facture ne peut pas être émise sans : ${manquantes.join(", ")}.`}</p>
        </Alerte>
      ) : null}
      <Carte titre="Mentions légales, coordonnées et numérotation">
        {droits.identite ? (
          <FormulaireIdentite parametres={p} annee={annee} />
        ) : (
          <IdentiteLecture p={p} annee={annee} />
        )}
      </Carte>
      <Carte titre="TVA, retenue et délai de paiement">
        {droits.operationnel ? (
          <FormulaireOperationnel parametres={p} />
        ) : (
          <dl className="mp-liste-def">
            <div>
              <dt>TVA</dt>
              <dd>{`${pct(p.taux_tva_defaut)} par défaut ; débours ${pct(p.taux_tva_debours)}`}</dd>
            </div>
            <div>
              <dt>Retenue</dt>
              <dd>
                {p.retenue_active
                  ? `${p.retenue_libelle} : ${pct(p.retenue_taux)} sur ${BASE_RETENUE_LIBELLES[p.retenue_base]}`
                  : "Désactivée"}
              </dd>
            </div>
            <div>
              <dt>Délai de paiement</dt>
              <dd>{`${p.delai_paiement_jours} jours`}</dd>
            </div>
          </dl>
        )}
      </Carte>
      {p.modifie_le ? (
        <p className="mp-texte-petit mp-texte-doux">
          Dernière modification le {formaterDateHeure(p.modifie_le)}.
        </p>
      ) : null}
    </>
  );
}

function IdentiteLecture({ p, annee }: { p: ParametresFacturation; annee: number }) {
  const lignes: [string, string | null][] = [
    ["Raison sociale", p.raison_sociale],
    ["Forme juridique", p.forme_juridique],
    ["Numéro RCCM", p.rccm],
    ["Compte contribuable", p.compte_contribuable],
    ["Régime fiscal", p.regime_fiscal],
    ["Adresse", p.adresse],
    ["Banque", p.banque],
    [p.iban_masque ? "IBAN (masqué)" : "IBAN", p.iban],
    ["Numérotation", `Format : ${apercuNumero(p.prefixe_facture, p.chiffres_numero, annee)}`],
  ];
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">Modifiables par un associé (gestion du cabinet).</p>
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
