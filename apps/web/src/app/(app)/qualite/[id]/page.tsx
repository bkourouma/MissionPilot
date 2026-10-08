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

export const metadata: Metadata = { title: "Livrable suivi" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS_EVENEMENT: Record<string, string> = {
  ouverture: "Suivi ouvert",
  relevement_classe: "Classe relevée",
  passage_en_revue: "Revue ouverte",
  validation_complete: "Garde satisfaite : livrable validé",
  signature: "Livrable signé",
};

/**
 * Dossier de qualité d'un livrable : classe de risque, garde, définition de terminé, revue
 * guidée, signature. Toutes les règles (ordre des étapes, séparation des tâches, quatre yeux,
 * parcours obligatoire) sont appliquées par l'API ; cet écran les restitue.
 */
export default async function PageSuivi({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerConsultationQualite();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const r = await chargerServeur<DetailSuivi>(cheminSuivi(id));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Livrable suivi" retour={{ href: "/qualite", libelle: "Qualité" }} />
        <EtatErreur
          titre="Le dossier n'a pas pu être chargé."
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
        soustitre={`${libelleType(suivi.type_livrable)} · version ${suivi.version} · mission ${d.mission.intitule}`}
        retour={{ href: "/qualite", libelle: "Qualité" }}
        badges={
          <>
            <BadgeStatut tonalite={tonaliteClasse(suivi.classe)}>
              {libelleClasse(suivi.classe)}
            </BadgeStatut>
            <BadgeStatut tonalite={tonaliteStatutSuivi(suivi.statut)}>
              {libelleStatutSuivi(suivi.statut)}
            </BadgeStatut>
          </>
        }
      />

      <Carte titre="Garde et signature">
        <GardeEtSignature detail={d} droits={droits} />
      </Carte>

      <div className="mp-qualite__colonnes">
        <Carte titre="Définition de terminé">
          <DefinitionTermine
            suiviId={suivi.id}
            definition={d.definition}
            ouvert={verifOuverte}
            peutAttester={droits.relire}
            enRevue={suivi.statut === "en_revue"}
          />
        </Carte>
        <Carte titre="Revue guidée">
          {suivi.statut === "brouillon" ? (
            <p className="mp-texte-doux">
              Le parcours s&apos;ouvre dès que la définition de terminé a été vérifiée.
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
        <Carte titre="Relever la classe de risque" niveauTitre={2}>
          <ReleverClasse suiviId={suivi.id} classe={suivi.classe} />
        </Carte>
      ) : null}

      <Carte titre="Historique">
        <ol className="mp-liste-lignes">
          {d.evenements.map((e) => (
            <li key={e.rang} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <span>{ACTIONS_EVENEMENT[e.action] ?? e.action}</span>
                <span className="mp-texte-doux mp-texte-petit">
                  {e.par_nom ?? "—"} · {formaterDateHeure(e.le)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </Carte>
    </div>
  );
}
