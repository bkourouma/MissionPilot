import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../lib/format";
import {
  peutAnnulerAbsence,
  STATUT_ABSENCE,
  TYPE_ABSENCE_LIBELLES,
  type Absence,
  type MonPlanning,
} from "../../../../lib/planification";
import { aujourdhuiIso } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import { AnnulationAbsence, DemandeAbsence } from "./Conges";

export const metadata: Metadata = { title: "Mes congés et absences" };

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageMesConges({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("conges.demander");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const valideur = aPermission(utilisateur.roles, "conges.valider");
  // Un valideur reçoit toutes les demandes du cabinet : on filtre sur sa propre fiche.
  let filtre = "";
  if (valideur) {
    const moi = await chargerServeur<MonPlanning>("/api/mon-planning");
    if (moi.ok && moi.donnees.collaborateur)
      filtre = `&collaborateur_id=${moi.donnees.collaborateur.id}`;
  }
  const liste = await chargerServeur<{ elements: Absence[]; curseur_suivant: string | null }>(
    `/api/absences?limite=50${filtre}${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );
  const aujourdhui = aujourdhuiIso();
  const miennes = liste.ok
    ? liste.donnees.elements.filter((a) => a.demandeur_id === utilisateur.id)
    : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Mes congés et absences"
        soustitre="Demandez une absence, suivez sa validation, annulez-la avant qu'elle ne commence. Seules les absences validées réduisent votre capacité."
      />
      <Carte titre="Nouvelle demande">
        <DemandeAbsence aujourdhui={aujourdhui} />
      </Carte>

      <section aria-labelledby="titre-demandes" className="mp-pile">
        <h2 id="titre-demandes" className="mp-section__titre">
          Mes demandes
        </h2>
        {!liste.ok ? (
          <EtatErreur
            titre="Vos demandes n'ont pas pu être chargées."
            message={liste.message}
            hrefReessayer="/planning/conges"
          />
        ) : miennes.length === 0 ? (
          <EtatVide titre="Aucune demande d'absence." icone="calendrier">
            <p>Vos demandes apparaîtront ici avec leur état de validation.</p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-cartes">
            {miennes.map((a) => {
              const libelle = `${TYPE_ABSENCE_LIBELLES[a.type]} du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`;
              const statut = STATUT_ABSENCE[a.statut];
              return (
                <li key={a.id}>
                  <Carte
                    niveauTitre={3}
                    titre={TYPE_ABSENCE_LIBELLES[a.type]}
                    actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
                  >
                    <div className="mp-pile">
                      <dl className="mp-liste-def mp-liste-def--compacte">
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
                        {a.statut === "refusee" && a.motif_refus ? (
                          <div>
                            <dt>Motif du refus</dt>
                            <dd className="mp-texte-preserve">{a.motif_refus}</dd>
                          </div>
                        ) : null}
                        {a.decide_le ? (
                          <div>
                            <dt>Décidée le</dt>
                            <dd>{formaterDateHeure(a.decide_le)}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>Demandée le</dt>
                          <dd>{formaterDateHeure(a.cree_le)}</dd>
                        </div>
                      </dl>
                      {peutAnnulerAbsence(a, utilisateur.id, aujourdhui) ? (
                        <AnnulationAbsence id={a.id} libelle={libelle} />
                      ) : null}
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
                ? `/planning/conges?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? "/planning/conges" : null}
          />
        ) : null}
      </section>
    </div>
  );
}
