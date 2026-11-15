import { creerTraduire, type Langue } from "@missionpilot/shared";
import { joursAffiches, type ResultatOffreFinanciere } from "../../lib/banque-ao";
import { formaterMontantMineur, formaterNombre, libelleDevise } from "../../lib/format";
import { Tableau } from "../ui/Tableau";

/**
 * Résultat d'une offre financière tel que calculé par l'API (moteur `offre-financiere`) :
 * affichage seulement, aucun calcul ici. Rendu par une page serveur ET par un composant client :
 * la langue arrive par la propriété `langue` (défaut « fr »).
 */
export function ResultatFinancier({
  resultat: r,
  titre,
  langue = "fr",
}: {
  resultat: ResultatOffreFinanciere;
  titre: string;
  langue?: Langue;
}) {
  const t = creerTraduire(langue);
  const m = (v: number) => formaterMontantMineur(v, r.devise, langue);
  const unite = langue === "en" ? "d" : "j";
  const lignes = [
    ...r.honoraires.map((l, i) => ({
      id: `h${i}`,
      nature: t("Honoraires", "Fees"),
      ...l,
      unite,
    })),
    ...r.per_diem.map((l, i) => ({ id: `p${i}`, nature: "Per diem", ...l, unite: "" })),
    ...r.debours.map((l, i) => ({
      id: `d${i}`,
      nature: t("Débours", "Expenses"),
      ...l,
      unite: "",
    })),
  ];
  return (
    <section aria-label={titre}>
      <h3>{titre}</h3>
      <Tableau
        legende={t("Lignes de l'offre", "Bid lines")}
        cleLigne={(l) => l.id}
        lignes={lignes}
        colonnes={[
          { cle: "nature", entete: t("Nature", "Type") },
          { cle: "libelle", entete: t("Libellé", "Label") },
          {
            cle: "quantite",
            entete: t("Quantité", "Quantity"),
            alignement: "droite",
            rendu: (l) => `${formaterNombre(l.quantite, 2, langue)}${l.unite ? ` ${l.unite}` : ""}`,
          },
          {
            cle: "prix_unitaire",
            entete: t("Prix unitaire", "Unit price"),
            alignement: "droite",
            rendu: (l) => m(l.prix_unitaire),
          },
          {
            cle: "montant",
            entete: t("Montant", "Amount"),
            alignement: "droite",
            rendu: (l) => m(l.montant),
          },
        ]}
      />
      <Tableau
        legende={t("Jours par expert", "Days per expert")}
        cleLigne={(j) => j.cle}
        lignes={r.jours_par_expert}
        messageVide={t("Aucun honoraire.", "No fees.")}
        colonnes={[
          { cle: "libelle", entete: t("Expert", "Expert") },
          {
            cle: "jours_centiemes",
            entete: t("Jours", "Days"),
            alignement: "droite",
            rendu: (j) => joursAffiches(j.jours_centiemes, langue),
          },
          {
            cle: "montant",
            entete: t("Honoraires", "Fees"),
            alignement: "droite",
            rendu: (j) => m(j.montant),
          },
        ]}
      />
      <dl className="mp-liste-def">
        <div>
          <dt>{t("Total des jours", "Total days")}</dt>
          <dd>{joursAffiches(r.total_jours_centiemes, langue)}</dd>
        </div>
        <div>
          <dt>{t("Honoraires", "Fees")}</dt>
          <dd>{m(r.sous_total_honoraires)}</dd>
        </div>
        <div>
          <dt>Per diem</dt>
          <dd>{m(r.sous_total_per_diem)}</dd>
        </div>
        <div>
          <dt>{t("Débours", "Expenses")}</dt>
          <dd>{m(r.sous_total_debours)}</dd>
        </div>
        <div>
          <dt>{t("Total hors taxes", "Total excl. tax")}</dt>
          <dd>{m(r.total_ht)}</dd>
        </div>
        {r.taxes.map((taxe) => (
          <div key={taxe.libelle}>
            <dt>
              {taxe.libelle} ({formaterNombre(taxe.taux, 4, langue)} %)
            </dt>
            <dd>{m(taxe.montant)}</dd>
          </div>
        ))}
        <div>
          <dt>{t("Total toutes taxes comprises", "Total incl. tax")}</dt>
          <dd>
            <strong>{m(r.total_ttc)}</strong>
          </dd>
        </div>
        {r.conversion ? (
          <div>
            <dt>
              {t(
                `Équivalent en ${libelleDevise(r.conversion.devise_cible)} (taux ${formaterNombre(r.conversion.taux, 6, langue)})`,
                `Equivalent in ${libelleDevise(r.conversion.devise_cible)} (rate ${formaterNombre(r.conversion.taux, 6, langue)})`,
              )}
            </dt>
            <dd>
              {formaterMontantMineur(r.conversion.total_ttc, r.conversion.devise_cible, langue)}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
