import type { RedChecklistVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { libelleDomaine, libelleSecteur } from "../../lib/redressement";
import {
  cheminArchivageChecklist,
  formaterTaux,
  libelleOrigineChecklist,
  libelleStatutChecklist,
  MENTION_CHECKLIST_A_VALIDER,
  TEXTE_CHECKLISTS_LECTURE_SEULE,
  tonaliteStatutChecklist,
} from "../../lib/redressement-diagnostic";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";
import { BoutonActionRed } from "./BoutonActionRed";
import { ChecklistSaisie } from "./ChecklistSaisie";

/**
 * Une check-list activée : origine, statut, complétude et conformité du moteur (points de base
 * déjà calculés, mis en forme sans rien additionner) par domaine, saisie des réponses et
 * archivage. Lecture seule sans droit d'écriture, hors dossier ouvert ou une fois archivée.
 */
export function ChecklistCarte({
  checklist: c,
  peutEcrire,
}: {
  checklist: RedChecklistVue;
  peutEcrire: boolean;
}) {
  const lectureSeule = !(peutEcrire && c.peut_repondre && c.statut === "active");
  const g = c.evaluation.global;
  const derniere = c.reponses.reduce((m, r) => (r.cree_le > m ? r.cree_le : m), "");
  return (
    <Carte
      titre={c.intitule}
      niveauTitre={3}
      actions={
        <BadgeStatut tonalite={tonaliteStatutChecklist(c.statut)}>
          {libelleStatutChecklist(c.statut)}
        </BadgeStatut>
      }
    >
      <div className="mp-red-carte-corps">
        <p className="mp-diag-meta mp-texte-doux">
          <span>{libelleOrigineChecklist(c.origine)}</span>
          <span>Secteur {libelleSecteur(c.secteur)}</span>
          <span>Activée le {formaterDateHeure(c.cree_le)}</span>
          {c.archivee_le ? <span>Archivée le {formaterDateHeure(c.archivee_le)}</span> : null}
        </p>
        {c.a_valider_par_un_expert ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>{MENTION_CHECKLIST_A_VALIDER}</p>
          </Alerte>
        ) : null}
        <dl className="mp-diag-taux">
          <div>
            <dt>Complétude</dt>
            <dd>{formaterTaux(g.completude_pb)}</dd>
          </div>
          <div>
            <dt>Conformité</dt>
            <dd>{formaterTaux(g.conformite_pb)}</dd>
          </div>
        </dl>
        <Tableau
          legende={`Complétude et conformité par domaine : ${c.intitule}`}
          messageVide="Aucun domaine évalué."
          colonnes={[
            { cle: "domaine", entete: "Domaine", rendu: (d) => libelleDomaine(d.domaine) },
            {
              cle: "completude",
              entete: "Complétude",
              alignement: "droite",
              rendu: (d) => formaterTaux(d.completude_pb),
            },
            {
              cle: "conformite",
              entete: "Conformité",
              alignement: "droite",
              rendu: (d) => formaterTaux(d.conformite_pb),
            },
          ]}
          lignes={c.evaluation.domaines}
          cleLigne={(d) => d.domaine}
        />
        {lectureSeule && c.statut === "active" ? (
          <p className="mp-texte-doux">{TEXTE_CHECKLISTS_LECTURE_SEULE}</p>
        ) : null}
        <details className="mp-diag-details">
          <summary>
            {lectureSeule ? "Voir les réponses" : "Répondre aux items"} ({c.items.length})
          </summary>
          <ChecklistSaisie
            key={`${c.reponses.length}-${derniere}`}
            checklistId={c.id}
            items={c.items}
            reponses={c.reponses}
            lectureSeule={lectureSeule}
          />
        </details>
        {!lectureSeule ? (
          <BoutonActionRed
            libelle="Archiver"
            chemin={cheminArchivageChecklist(c.id)}
            corps={{}}
            succes="Check-list archivée : elle n'est plus modifiable."
            titreErreur="Archivage impossible"
            confirmation={{
              question: "Archiver cette check-list ? Elle ne pourra plus être modifiée.",
              libelleConfirmation: "Oui, archiver",
            }}
          />
        ) : null}
      </div>
    </Carte>
  );
}
