import type { Metadata } from "next";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../../lib/format";
import {
  peutDeciderAbsence,
  STATUT_ABSENCE,
  TYPE_ABSENCE_LIBELLES,
  type Absence,
} from "../../../../../lib/planification";
import { exigerPermission } from "../../../../../lib/session";
import { DecisionAbsence } from "../Conges";

export const metadata: Metadata = { title: "Congés à valider" };

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageCongesAValider({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("conges.valider");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const liste = await chargerServeur<{ elements: Absence[]; curseur_suivant: string | null }>(
    `/api/absences?statut=demandee&limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Congés à valider"
        soustitre="Demandes en attente, de la plus proche à la plus lointaine. Un refus exige un motif, transmis au collaborateur."
      />
      {!liste.ok ? (
        <EtatErreur
          titre="Les demandes n'ont pas pu être chargées."
          message={liste.message}
          hrefReessayer="/planning/conges/validation"
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune demande en attente." icone="succes">
          <p>Les nouvelles demandes d&apos;absence apparaîtront ici.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {liste.donnees.elements.map((a) => {
            const libelle = `${a.collaborateur_nom}, ${TYPE_ABSENCE_LIBELLES[a.type].toLowerCase()} du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`;
            return (
              <li key={a.id}>
                <Carte
                  niveauTitre={2}
                  titre={a.collaborateur_nom}
                  actions={
                    <BadgeStatut tonalite={STATUT_ABSENCE[a.statut].tonalite}>
                      {STATUT_ABSENCE[a.statut].libelle}
                    </BadgeStatut>
                  }
                >
                  <div className="mp-pile">
                    <dl className="mp-liste-def mp-liste-def--compacte">
                      <div>
                        <dt>Type</dt>
                        <dd>{TYPE_ABSENCE_LIBELLES[a.type]}</dd>
                      </div>
                      <div>
                        <dt>Période</dt>
                        <dd>{`Du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`}</dd>
                      </div>
                      {a.commentaire ? (
                        <div>
                          <dt>Commentaire</dt>
                          <dd className="mp-texte-preserve">{a.commentaire}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Demandée le</dt>
                        <dd>{formaterDateHeure(a.cree_le)}</dd>
                      </div>
                    </dl>
                    {peutDeciderAbsence(a, utilisateur.roles, utilisateur.id) ? (
                      <DecisionAbsence id={a.id} libelle={libelle} />
                    ) : (
                      <p className="mp-texte-doux">
                        C&apos;est votre propre demande : un autre valideur la traitera.
                      </p>
                    )}
                  </div>
                </Carte>
              </li>
            );
          })}
        </ul>
      )}
      {liste.ok ? (
        <PaginationCurseur
          libelle="Pages des demandes"
          hrefSuivante={
            liste.donnees.curseur_suivant
              ? `/planning/conges/validation?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
              : null
          }
          hrefDebut={curseur ? "/planning/conges/validation" : null}
        />
      ) : null}
    </div>
  );
}
