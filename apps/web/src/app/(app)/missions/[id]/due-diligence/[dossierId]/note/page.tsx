import Link from "next/link";
import type { Metadata } from "next";
import { BadgeEtatNote } from "../../../../../../../components/due-diligence/BadgesDd";
import { ControleNote } from "../../../../../../../components/due-diligence/ControleNote";
import { EditeurNote } from "../../../../../../../components/due-diligence/EditeurNote";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminNotes,
  cheminSynthese,
  droitsDd,
  hrefEcranDossier,
  hrefNote,
  type NoteResume,
  type SyntheseDossier,
} from "../../../../../../../lib/due-diligence";
import { formaterDate } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Notes au comité", "Committee memos") };
}

/**
 * Notes au comité du dossier (DD-13) : brouillon, soumission (base de chiffres figée par les
 * moteurs), validation par un tiers, puis rapport PDF ou Word en variante exécutive ou détaillée.
 */
export default async function PageNotesDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const [notes, synthese] = await Promise.all([
    chargerServeur<{ elements: NoteResume[] }>(cheminNotes(dossierId)),
    chargerServeur<SyntheseDossier>(cheminSynthese(dossierId)),
  ]);

  return (
    <>
      <ControleNote
        missionId={id}
        dossierId={dossierId}
        controle={synthese.ok ? synthese.donnees.controle_note : null}
      />
      <Carte titre={t("Notes au comité", "Committee memos")} niveauTitre={3}>
        {!notes.ok ? (
          <EtatErreur
            titre={t("Les notes n'ont pas pu être chargées.", "The memos could not be loaded.")}
            message={notes.message}
            hrefReessayer={hrefEcranDossier(id, dossierId, "note")}
          />
        ) : notes.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucune note au comité.", "No committee memo.")} icone="livre">
            <p>
              {droits.ecrire
                ? t(
                    "Rédigez la recommandation et la synthèse : la note est contrôlée par le moteur, soumise, puis validée par une autre personne.",
                    "Write the recommendation and the summary: the memo is checked by the engine, submitted, then approved by another person.",
                  )
                : t(
                    "Les notes apparaîtront ici dès qu'un consultant en aura rédigé une.",
                    "Memos will appear here as soon as a consultant has written one.",
                  )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-dd-liste" aria-label={t("Notes au comité", "Committee memos")}>
            {notes.donnees.elements.map((n) => (
              <li key={n.id} className="mp-dd-element">
                <h4 className="mp-dd-element__titre">
                  <Link href={hrefNote(id, dossierId, n.id)}>{n.titre}</Link>
                </h4>
                <span className="mp-dd-meta">
                  <BadgeEtatNote etat={n.etat} />
                  <span className="mp-texte-petit">{`Version ${n.derniere_version}`}</span>
                  {n.validee_version ? (
                    <span className="mp-texte-petit">
                      {t(
                        `Validée : version ${n.validee_version}`,
                        `Approved: version ${n.validee_version}`,
                      )}
                    </span>
                  ) : null}
                </span>
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    `Créée le ${formaterDate(n.cree_le)}`,
                    `Created on ${formaterDate(n.cree_le, "UTC", langue)}`,
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Carte>
      {droits.ecrire ? (
        <Carte titre={t("Nouvelle note", "New memo")} niveauTitre={3}>
          <EditeurNote missionId={id} dossierId={dossierId} />
        </Carte>
      ) : null}
    </>
  );
}
