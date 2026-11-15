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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modèle de questionnaire", "Questionnaire template") };
}

/** Modèle de questionnaire : versions (brouillon au plus un, validées figées), actions. */
export default async function PageModele({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          titre={t("Modèle de questionnaire", "Questionnaire template")}
          retour={{ href: "/questionnaires", libelle: t("Questionnaires", "Questionnaires") }}
        />
        <EtatErreur
          titre={t("Le modèle n'a pas pu être chargé.", "The template could not be loaded.")}
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
        retour={{ href: "/questionnaires", libelle: t("Questionnaires", "Questionnaires") }}
        soustitre={t(
          `Code ${m.code} · ${origineModele(m.origine)} · créé le ${formaterDateHeure(m.cree_le)}`,
          `Code ${m.code} · ${origineModele(m.origine, langue)} · created on ${formaterDateHeure(m.cree_le, undefined, langue)}`,
        )}
        badges={
          validee ? (
            <BadgeStatut tonalite="succes">
              {t(
                `Version ${validee.version} validée, envoyable`,
                `Version ${validee.version} approved, can be sent`,
              )}
            </BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">
              {t("Aucune version validée", "No approved version")}
            </BadgeStatut>
          )
        }
        actions={
          gerer ? (
            <Link
              href={`/questionnaires/nouveau?copie=${encodeURIComponent(m.id)}`}
              className={classesBouton("secondaire")}
            >
              <Icone nom="copie" />
              <span>{t("Copier ce modèle", "Copy this template")}</span>
            </Link>
          ) : null
        }
      />

      <Carte titre={t("Version de travail", "Working version")}>
        {brouillon ? (
          <div className="mp-pile">
            <p>
              {t(
                `La version ${brouillon.version} est un brouillon, modifié le ${formaterDateHeure(brouillon.modifie_le)}. Elle doit être validée pour pouvoir être envoyée.`,
                `Version ${brouillon.version} is a draft, edited on ${formaterDateHeure(brouillon.modifie_le, undefined, langue)}. It must be approved before it can be sent.`,
              )}
            </p>
            <div>
              <Link
                href={`/questionnaires/versions/${brouillon.id}`}
                className={classesBouton(gerer ? "primaire" : "secondaire")}
              >
                <Icone nom={gerer ? "crayon" : "oeil"} />
                <span>
                  {gerer
                    ? t(
                        `Modifier la version ${brouillon.version}`,
                        `Edit version ${brouillon.version}`,
                      )
                    : t(
                        `Consulter la version ${brouillon.version}`,
                        `View version ${brouillon.version}`,
                      )}
                </span>
              </Link>
            </div>
          </div>
        ) : gerer ? (
          <div className="mp-pile">
            <p>
              {m.versions.length > 0
                ? t(
                    `Les versions validées sont figées. Pour faire évoluer le questionnaire, créez la version ${prochaine} : elle reprend la dernière version et s'ouvre en brouillon.`,
                    `Approved versions are locked. To evolve the questionnaire, create version ${prochaine}: it takes over the latest version and opens as a draft.`,
                  )
                : t("Ce modèle n'a pas encore de version.", "This template has no version yet.")}
            </p>
            <NouvelleVersion modeleId={m.id} prochaine={prochaine} />
          </div>
        ) : (
          <p className="mp-texte-doux">{t("Aucun brouillon en cours.", "No draft in progress.")}</p>
        )}
      </Carte>

      {validee ? null : (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {t(
              "Tant qu'aucune version n'est validée, ce modèle ne peut pas être envoyé aux répondants d'une mission.",
              "Until a version is approved, this template cannot be sent to the respondents of an engagement.",
            )}
          </p>
        </Alerte>
      )}

      <section className="mp-pile" aria-labelledby="titre-versions">
        <h2 id="titre-versions" className="mp-section__titre">
          {t("Versions", "Versions")}
        </h2>
        <Tableau<VersionResume>
          legende={t(`Versions du modèle ${m.titre}`, `Versions of the template ${m.titre}`)}
          cleLigne={(v) => v.id}
          lignes={m.versions}
          messageVide={t("Aucune version.", "No version.")}
          colonnes={[
            {
              cle: "version",
              entete: t("Version", "Version"),
              rendu: (v) => t(`Version ${v.version}`, `Version ${v.version}`),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (v) => {
                const s = libelleStatut(STATUT_VERSION, v.statut, langue);
                return <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>;
              },
            },
            {
              cle: "cree_le",
              entete: t("Créée le", "Created on"),
              rendu: (v) => formaterDateHeure(v.cree_le, undefined, langue),
            },
            {
              cle: "valide_le",
              entete: t("Validée le", "Approved on"),
              rendu: (v) =>
                v.valide_le ? formaterDateHeure(v.valide_le, undefined, langue) : VALEUR_ABSENTE,
            },
            {
              cle: "ouvrir",
              entete: t("Définition", "Definition"),
              rendu: (v) => (
                <Link href={`/questionnaires/versions/${v.id}`}>
                  {v.statut === "brouillon" && gerer
                    ? t("Modifier", "Edit")
                    : t("Consulter", "View")}
                  <span className="mp-visuellement-cache">
                    {t(` la version ${v.version}`, ` version ${v.version}`)}
                  </span>
                </Link>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
