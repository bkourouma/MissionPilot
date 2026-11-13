import type { RedChecklistVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libelleDomaine, libelleSecteur } from "../../lib/redressement";
import {
  cheminArchivageChecklist,
  formaterTaux,
  libelleOrigineChecklist,
  libelleStatutChecklist,
  MENTION_CHECKLIST_A_VALIDER,
  MENTION_CHECKLIST_A_VALIDER_EN,
  TEXTE_CHECKLISTS_LECTURE_SEULE,
  TEXTE_CHECKLISTS_LECTURE_SEULE_EN,
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
export async function ChecklistCarte({
  checklist: c,
  peutEcrire,
}: {
  checklist: RedChecklistVue;
  peutEcrire: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const lectureSeule = !(peutEcrire && c.peut_repondre && c.statut === "active");
  const g = c.evaluation.global;
  const derniere = c.reponses.reduce((m, r) => (r.cree_le > m ? r.cree_le : m), "");
  return (
    <Carte
      titre={c.intitule}
      niveauTitre={3}
      actions={
        <BadgeStatut tonalite={tonaliteStatutChecklist(c.statut)}>
          {libelleStatutChecklist(c.statut, langue)}
        </BadgeStatut>
      }
    >
      <div className="mp-red-carte-corps">
        <p className="mp-diag-meta mp-texte-doux">
          <span>{libelleOrigineChecklist(c.origine, langue)}</span>
          <span>
            {t("Secteur", "Sector")} {libelleSecteur(c.secteur, langue)}
          </span>
          <span>
            {t("Activée le", "Activated on")} {formaterDateHeure(c.cree_le, undefined, langue)}
          </span>
          {c.archivee_le ? (
            <span>
              {t("Archivée le", "Archived on")}{" "}
              {formaterDateHeure(c.archivee_le, undefined, langue)}
            </span>
          ) : null}
        </p>
        {c.a_valider_par_un_expert ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>{t(MENTION_CHECKLIST_A_VALIDER, MENTION_CHECKLIST_A_VALIDER_EN)}</p>
          </Alerte>
        ) : null}
        <dl className="mp-diag-taux">
          <div>
            <dt>{t("Complétude", "Completeness")}</dt>
            <dd>{formaterTaux(g.completude_pb, langue)}</dd>
          </div>
          <div>
            <dt>{t("Conformité", "Compliance")}</dt>
            <dd>{formaterTaux(g.conformite_pb, langue)}</dd>
          </div>
        </dl>
        <Tableau
          legende={t(
            `Complétude et conformité par domaine : ${c.intitule}`,
            `Completeness and compliance by area: ${c.intitule}`,
          )}
          messageVide={t("Aucun domaine évalué.", "No area assessed.")}
          colonnes={[
            {
              cle: "domaine",
              entete: t("Domaine", "Area"),
              rendu: (d) => libelleDomaine(d.domaine, langue),
            },
            {
              cle: "completude",
              entete: t("Complétude", "Completeness"),
              alignement: "droite",
              rendu: (d) => formaterTaux(d.completude_pb, langue),
            },
            {
              cle: "conformite",
              entete: t("Conformité", "Compliance"),
              alignement: "droite",
              rendu: (d) => formaterTaux(d.conformite_pb, langue),
            },
          ]}
          lignes={c.evaluation.domaines}
          cleLigne={(d) => d.domaine}
        />
        {lectureSeule && c.statut === "active" ? (
          <p className="mp-texte-doux">
            {t(TEXTE_CHECKLISTS_LECTURE_SEULE, TEXTE_CHECKLISTS_LECTURE_SEULE_EN)}
          </p>
        ) : null}
        <details className="mp-diag-details">
          <summary>
            {lectureSeule
              ? t("Voir les réponses", "View the answers")
              : t("Répondre aux items", "Answer the items")}{" "}
            ({c.items.length})
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
            libelle={t("Archiver", "Archive")}
            chemin={cheminArchivageChecklist(c.id)}
            corps={{}}
            succes={t(
              "Check-list archivée : elle n'est plus modifiable.",
              "Checklist archived: it can no longer be edited.",
            )}
            titreErreur={t("Archivage impossible", "Archiving not possible")}
            confirmation={{
              question: t(
                "Archiver cette check-list ? Elle ne pourra plus être modifiée.",
                "Archive this checklist? It will no longer be editable.",
              ),
              libelleConfirmation: t("Oui, archiver", "Yes, archive"),
            }}
          />
        ) : null}
      </div>
    </Carte>
  );
}
