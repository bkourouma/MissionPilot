import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure, VALEUR_ABSENTE } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import {
  libelleStatut,
  origineModele,
  peutGererQuestionnaires,
  STATUT_VERSION,
  type ModeleDetail,
  type VersionResume,
} from "../../../../lib/questionnaires";
import { exigerPermission } from "../../../../lib/session";
import { NouvelleVersion } from "./ActionsModele";

export const metadata: Metadata = { title: "Modèle de questionnaire" };

/** Modèle de questionnaire : versions (brouillon au plus un, validées figées), actions. */
export default async function PageModele({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("questionnaire.lire");
  const gerer = peutGererQuestionnaires(utilisateur.roles);
  const r = await chargerServeur<ModeleDetail>(`/api/questionnaires/modeles/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Modèle de questionnaire"
          retour={{ href: "/questionnaires", libelle: "Questionnaires" }}
        />
        <EtatErreur
          titre="Le modèle n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={`/questionnaires/${id}`}
        />
      </div>
    );
  }
  const m = r.donnees;
  const brouillon = m.versions.find((v) => v.statut === "brouillon");
  const validee = m.versions.find((v) => v.statut === "valide");
  const prochaine = (m.versions[0]?.version ?? 0) + 1;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={m.titre}
        retour={{ href: "/questionnaires", libelle: "Questionnaires" }}
        soustitre={`Code ${m.code} · ${origineModele(m.origine)} · créé le ${formaterDateHeure(m.cree_le)}`}
        badges={
          validee ? (
            <BadgeStatut tonalite="succes">{`Version ${validee.version} validée, envoyable`}</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">Aucune version validée</BadgeStatut>
          )
        }
        actions={
          gerer ? (
            <Link
              href={`/questionnaires/nouveau?copie=${encodeURIComponent(m.id)}`}
              className={classesBouton("secondaire")}
            >
              <Icone nom="copie" />
              <span>Copier ce modèle</span>
            </Link>
          ) : null
        }
      />

      <Carte titre="Version de travail">
        {brouillon ? (
          <div className="mp-pile">
            <p>
              {`La version ${brouillon.version} est un brouillon, modifié le ${formaterDateHeure(brouillon.modifie_le)}. Elle doit être validée pour pouvoir être envoyée.`}
            </p>
            <div>
              <Link
                href={`/questionnaires/versions/${brouillon.id}`}
                className={classesBouton(gerer ? "primaire" : "secondaire")}
              >
                <Icone nom={gerer ? "crayon" : "oeil"} />
                <span>
                  {gerer
                    ? `Modifier la version ${brouillon.version}`
                    : `Consulter la version ${brouillon.version}`}
                </span>
              </Link>
            </div>
          </div>
        ) : gerer ? (
          <div className="mp-pile">
            <p>
              {m.versions.length > 0
                ? `Les versions validées sont figées. Pour faire évoluer le questionnaire, créez la version ${prochaine} : elle reprend la dernière version et s'ouvre en brouillon.`
                : "Ce modèle n'a pas encore de version."}
            </p>
            <NouvelleVersion modeleId={m.id} prochaine={prochaine} />
          </div>
        ) : (
          <p className="mp-texte-doux">Aucun brouillon en cours.</p>
        )}
      </Carte>

      {validee ? null : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            Tant qu'aucune version n'est validée, ce modèle ne peut pas être envoyé aux répondants
            d'une mission.
          </p>
        </Alerte>
      )}

      <section className="mp-pile" aria-labelledby="titre-versions">
        <h2 id="titre-versions" className="mp-section__titre">
          Versions
        </h2>
        <Tableau<VersionResume>
          legende={`Versions du modèle ${m.titre}`}
          cleLigne={(v) => v.id}
          lignes={m.versions}
          messageVide="Aucune version."
          colonnes={[
            { cle: "version", entete: "Version", rendu: (v) => `Version ${v.version}` },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (v) => {
                const s = libelleStatut(STATUT_VERSION, v.statut);
                return <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>;
              },
            },
            { cle: "cree_le", entete: "Créée le", rendu: (v) => formaterDateHeure(v.cree_le) },
            {
              cle: "valide_le",
              entete: "Validée le",
              rendu: (v) => (v.valide_le ? formaterDateHeure(v.valide_le) : VALEUR_ABSENTE),
            },
            {
              cle: "ouvrir",
              entete: "Définition",
              rendu: (v) => (
                <Link href={`/questionnaires/versions/${v.id}`}>
                  {v.statut === "brouillon" && gerer ? "Modifier" : "Consulter"}
                  <span className="mp-visuellement-cache">{` la version ${v.version}`}</span>
                </Link>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
