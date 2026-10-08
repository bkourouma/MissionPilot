import { Carte } from "../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import type { Collaborateur, CoutsCollaborateur, LigneCouts } from "../../../../lib/collaborateurs";
import { formaterDate, formaterMontantMineur } from "../../../../lib/format";
import { FormulaireCouts } from "./FormulaireCouts";

/**
 * Coûts et taux d'un collaborateur (FIN-02). Server Component : à n'afficher que pour un
 * utilisateur ayant `finance.lire` (vérifié par la page appelante ; l'API le vérifie aussi).
 */
export async function SectionCouts({
  collaborateur,
  peutSaisir,
}: {
  collaborateur: Collaborateur;
  peutSaisir: boolean;
}) {
  const r = await chargerServeur<CoutsCollaborateur>(
    `/api/collaborateurs/${collaborateur.id}/couts`,
  );
  const montant = (v: number | null, l: LigneCouts) => formaterMontantMineur(v, l.devise);
  const externe = collaborateur.type !== "interne";

  return (
    <Carte
      titre="Coûts et taux"
      actions={
        <span className="mp-mention-confidentielle">Confidentiel : associés et gestionnaires</span>
      }
    >
      <div className="mp-pile">
        {!r.ok ? (
          <EtatErreur
            titre="Les coûts n'ont pas pu être chargés."
            message={r.message}
            hrefReessayer={`/collaborateurs/${collaborateur.id}`}
          />
        ) : r.donnees.historique.length === 0 ? (
          <EtatVide titre="Aucun coût enregistré pour ce collaborateur.">
            {peutSaisir ? <p>Saisissez la première ligne avec le formulaire ci-dessous.</p> : null}
          </EtatVide>
        ) : (
          <>
            {r.donnees.courant ? (
              <dl className="mp-liste-def">
                <div>
                  <dt>Coût journalier chargé en vigueur</dt>
                  <dd>{montant(r.donnees.courant.cout_journalier, r.donnees.courant)}</dd>
                </div>
                <div>
                  <dt>Taux de vente spécifique</dt>
                  <dd>
                    {r.donnees.courant.taux_vente_specifique === null
                      ? "Taux du grade"
                      : montant(r.donnees.courant.taux_vente_specifique, r.donnees.courant)}
                  </dd>
                </div>
                {externe || r.donnees.courant.cout_achat !== null ? (
                  <div>
                    <dt>Coût d&apos;achat journalier</dt>
                    <dd>{montant(r.donnees.courant.cout_achat, r.donnees.courant)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>En vigueur depuis le</dt>
                  <dd>{formaterDate(r.donnees.courant.depuis_le)}</dd>
                </div>
              </dl>
            ) : (
              <p className="mp-texte-doux">
                Aucune ligne n&apos;est encore en vigueur (dates d&apos;effet à venir).
              </p>
            )}
            <Tableau
              legende="Historique des coûts"
              legendeVisible
              lignes={r.donnees.historique}
              cleLigne={(l) => l.id}
              colonnes={[
                {
                  cle: "depuis_le",
                  entete: "Date d'effet",
                  rendu: (l) => formaterDate(l.depuis_le),
                },
                {
                  cle: "cout",
                  entete: "Coût journalier",
                  alignement: "droite",
                  rendu: (l) => montant(l.cout_journalier, l),
                },
                {
                  cle: "taux",
                  entete: "Taux spécifique",
                  alignement: "droite",
                  rendu: (l) => montant(l.taux_vente_specifique, l),
                },
                {
                  cle: "achat",
                  entete: "Coût d'achat",
                  alignement: "droite",
                  rendu: (l) => montant(l.cout_achat, l),
                },
              ]}
            />
          </>
        )}
        {peutSaisir ? (
          <FormulaireCouts collaborateurId={collaborateur.id} externe={externe} />
        ) : null}
      </div>
    </Carte>
  );
}
