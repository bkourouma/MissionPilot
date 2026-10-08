import { joursAffiches, type ResultatOffreFinanciere } from "../../lib/banque-ao";
import { formaterMontantMineur, formaterNombre } from "../../lib/format";
import { Tableau } from "../ui/Tableau";

/**
 * Résultat d'une offre financière tel que calculé par l'API (moteur `offre-financiere`) :
 * affichage seulement, aucun calcul ici.
 */
export function ResultatFinancier({
  resultat: r,
  titre,
}: {
  resultat: ResultatOffreFinanciere;
  titre: string;
}) {
  const m = (v: number) => formaterMontantMineur(v, r.devise);
  const lignes = [
    ...r.honoraires.map((l, i) => ({ id: `h${i}`, nature: "Honoraires", ...l, unite: "j" })),
    ...r.per_diem.map((l, i) => ({ id: `p${i}`, nature: "Per diem", ...l, unite: "" })),
    ...r.debours.map((l, i) => ({ id: `d${i}`, nature: "Débours", ...l, unite: "" })),
  ];
  return (
    <section aria-label={titre}>
      <h3>{titre}</h3>
      <Tableau
        legende="Lignes de l'offre"
        cleLigne={(l) => l.id}
        lignes={lignes}
        colonnes={[
          { cle: "nature", entete: "Nature" },
          { cle: "libelle", entete: "Libellé" },
          {
            cle: "quantite",
            entete: "Quantité",
            alignement: "droite",
            rendu: (l) => `${formaterNombre(l.quantite, 2)}${l.unite ? ` ${l.unite}` : ""}`,
          },
          {
            cle: "prix_unitaire",
            entete: "Prix unitaire",
            alignement: "droite",
            rendu: (l) => m(l.prix_unitaire),
          },
          { cle: "montant", entete: "Montant", alignement: "droite", rendu: (l) => m(l.montant) },
        ]}
      />
      <Tableau
        legende="Jours par expert"
        cleLigne={(j) => j.cle}
        lignes={r.jours_par_expert}
        messageVide="Aucun honoraire."
        colonnes={[
          { cle: "libelle", entete: "Expert" },
          {
            cle: "jours_centiemes",
            entete: "Jours",
            alignement: "droite",
            rendu: (j) => joursAffiches(j.jours_centiemes),
          },
          {
            cle: "montant",
            entete: "Honoraires",
            alignement: "droite",
            rendu: (j) => m(j.montant),
          },
        ]}
      />
      <dl className="mp-liste-def">
        <div>
          <dt>Total des jours</dt>
          <dd>{joursAffiches(r.total_jours_centiemes)}</dd>
        </div>
        <div>
          <dt>Honoraires</dt>
          <dd>{m(r.sous_total_honoraires)}</dd>
        </div>
        <div>
          <dt>Per diem</dt>
          <dd>{m(r.sous_total_per_diem)}</dd>
        </div>
        <div>
          <dt>Débours</dt>
          <dd>{m(r.sous_total_debours)}</dd>
        </div>
        <div>
          <dt>Total hors taxes</dt>
          <dd>{m(r.total_ht)}</dd>
        </div>
        {r.taxes.map((t) => (
          <div key={t.libelle}>
            <dt>
              {t.libelle} ({formaterNombre(t.taux, 4)} %)
            </dt>
            <dd>{m(t.montant)}</dd>
          </div>
        ))}
        <div>
          <dt>Total toutes taxes comprises</dt>
          <dd>
            <strong>{m(r.total_ttc)}</strong>
          </dd>
        </div>
        {r.conversion ? (
          <div>
            <dt>{`Équivalent en ${r.conversion.devise_cible} (taux ${formaterNombre(r.conversion.taux, 6)})`}</dt>
            <dd>{formaterMontantMineur(r.conversion.total_ttc, r.conversion.devise_cible)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
