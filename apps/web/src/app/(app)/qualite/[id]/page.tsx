import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../components/qualite/qualite.css";
import { DefinitionTermine } from "../../../../components/qualite/DefinitionTermine";
import { GardeEtSignature } from "../../../../components/qualite/GardeEtSignature";
import { ParcoursRevueGuidee } from "../../../../components/qualite/ParcoursRevueGuidee";
import { ReleverClasse } from "../../../../components/qualite/ReleverClasse";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { formaterDateHeure } from "../../../../lib/format";
import {
  cheminSuivi,
  droitsQualite,
  hrefSuivi,
  libelleClasse,
  libelleStatutSuivi,
  libelleType,
  tonaliteClasse,
  tonaliteStatutSuivi,
  type DetailSuivi,
} from "../../../../lib/qualite";
import { exigerConsultationQualite } from "../../../../lib/qualite-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Livrable suivi", "Tracked deliverable") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS_EVENEMENT: Record<string, [string, string]> = {
  ouverture: ["Suivi ouvert", "Follow-up opened"],
  relevement_classe: ["Classe relevée", "Class raised"],
  passage_en_revue: ["Revue ouverte", "Review opened"],
  validation_complete: [
    "Garde satisfaite : livrable validé",
    "Safeguard satisfied: deliverable approved",
  ],
  signature: ["Livrable signé", "Deliverable signed"],
};

/**
 * Dossier de qualité d'un livrable : classe de risque, garde, définition de terminé, revue
 * guidée, signature. Toutes les règles (ordre des étapes, séparation des tâches, quatre yeux,
 * parcours obligatoire) sont appliquées par l'API ; cet écran les restitue.
 */
export default async function PageSuivi({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerConsultationQualite();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const r = await chargerServeur<DetailSuivi>(cheminSuivi(id));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Livrable suivi", "Tracked deliverable")}
          retour={{ href: "/qualite", libelle: t("Qualité", "Quality") }}
        />
        <EtatErreur
          titre={t("Le dossier n'a pas pu être chargé.", "The file could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefSuivi(id)}
        />
      </div>
    );
  }
  const d = r.donnees;
  const droits = droitsQualite(session.utilisateur.roles);
  const { suivi } = d;
  const ouvertRevue = suivi.statut === "en_revue" || suivi.statut === "valide";
  const verifOuverte = suivi.statut === "brouillon" || suivi.statut === "en_revue";

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={suivi.libelle}
        soustitre={t(
          `${libelleType(suivi.type_livrable)} · version ${suivi.version} · mission ${d.mission.intitule}`,
          `${libelleType(suivi.type_livrable, "en")} · version ${suivi.version} · engagement ${d.mission.intitule}`,
        )}
        retour={{ href: "/qualite", libelle: t("Qualité", "Quality") }}
        badges={
          <>
            <BadgeStatut tonalite={tonaliteClasse(suivi.classe)}>
              {libelleClasse(suivi.classe, langue)}
            </BadgeStatut>
            <BadgeStatut tonalite={tonaliteStatutSuivi(suivi.statut)}>
              {libelleStatutSuivi(suivi.statut, langue)}
            </BadgeStatut>
          </>
        }
      />

      <Carte titre={t("Garde et signature", "Safeguard and signature")}>
        <GardeEtSignature detail={d} droits={droits} />
      </Carte>

      <div className="mp-qualite__colonnes">
        <Carte titre={t("Définition de terminé", "Definition of done")}>
          <DefinitionTermine
            suiviId={suivi.id}
            definition={d.definition}
            ouvert={verifOuverte}
            peutAttester={droits.relire}
            enRevue={suivi.statut === "en_revue"}
          />
        </Carte>
        <Carte titre={t("Revue guidée", "Guided review")}>
          {suivi.statut === "brouillon" ? (
            <p className="mp-texte-doux">
              {t(
                "Le parcours s'ouvre dès que la définition de terminé a été vérifiée.",
                "The review path opens once the definition of done has been verified.",
              )}
            </p>
          ) : (
            <ParcoursRevueGuidee
              suiviId={suivi.id}
              ouvert={ouvertRevue}
              elements={d.elements}
              parcours={d.parcours}
              temps={d.temps_revue}
              utilisateurId={session.utilisateur.id}
            />
          )}
        </Carte>
      </div>

      {droits.relire && (suivi.statut === "brouillon" || suivi.statut === "en_revue") ? (
        <Carte titre={t("Relever la classe de risque", "Raise the risk class")} niveauTitre={2}>
          <ReleverClasse suiviId={suivi.id} classe={suivi.classe} />
        </Carte>
      ) : null}

      <Carte titre={t("Historique", "History")}>
        <ol className="mp-liste-lignes">
          {d.evenements.map((e) => (
            <li key={e.rang} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <span>
                  {ACTIONS_EVENEMENT[e.action] ? t(...ACTIONS_EVENEMENT[e.action]!) : e.action}
                </span>
                <span className="mp-texte-doux mp-texte-petit">
                  {e.par_nom ?? "—"} · {formaterDateHeure(e.le, undefined, langue)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Carte>
    </div>
  );
}
