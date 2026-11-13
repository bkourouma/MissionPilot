import Link from "next/link";
import type { Metadata } from "next";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { aPermission } from "@missionpilot/shared";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDateHeure, formaterNombre } from "../../../lib/format";
import {
  cheminModeles,
  hrefAvecCurseur,
  lireCurseur,
  origineModele,
  peutGererQuestionnaires,
  type GabaritResume,
  type ModeleResume,
  type PageQuestionnaires,
} from "../../../lib/questionnaires";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Questionnaires", "Questionnaires") };
}

const BASE = "/questionnaires";

/**
 * Modèles de questionnaires du cabinet (SOC-10) : liste paginée, gabarits génériques de
 * CabinetPilot à copier, création d'un modèle.
 */
export default async function PageQuestionnaires({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("questionnaire.lire");
  const gerer = peutGererQuestionnaires(utilisateur.roles);
  const genererIa = gerer && aPermission(utilisateur.roles, "ia.utiliser");
  const curseur = lireCurseur((await searchParams).curseur);
  const [modeles, gabarits] = await Promise.all([
    chargerServeur<PageQuestionnaires<ModeleResume>>(cheminModeles(curseur)),
    chargerServeur<{ elements: GabaritResume[] }>("/api/questionnaires/gabarits"),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Questionnaires", "Questionnaires")}
        soustitre={t(
          "Modèles du cabinet, versionnés : une version validée est figée et s'envoie aux répondants du client depuis l'onglet « Questionnaires » d'une mission.",
          'Firm templates, versioned: an approved version is locked and is sent to the client\'s respondents from the "Questionnaires" tab of an engagement.',
        )}
        actions={
          gerer ? (
            <>
              {genererIa ? (
                <Link href="/questionnaires/generation-ia" className={classesBouton("secondaire")}>
                  <Icone nom="plus" />
                  <span>{t("Générer avec l'IA", "Generate with AI")}</span>
                </Link>
              ) : null}
              <Link href="/questionnaires/nouveau" className={classesBouton("primaire")}>
                <Icone nom="plus" />
                <span>{t("Nouveau modèle", "New template")}</span>
              </Link>
            </>
          ) : null
        }
      />

      <section className="mp-pile" aria-labelledby="titre-modeles">
        <h2 id="titre-modeles" className="mp-section__titre">
          {t("Modèles du cabinet", "Firm templates")}
        </h2>
        {!modeles.ok ? (
          <EtatErreur
            titre={t(
              "Les modèles de questionnaire n'ont pas pu être chargés.",
              "The questionnaire templates could not be loaded.",
            )}
            message={modeles.message}
            hrefReessayer={hrefAvecCurseur(BASE, curseur)}
          />
        ) : modeles.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucun modèle de questionnaire.", "No questionnaire template.")}
            icone="bulle"
          >
            <p>
              {curseur
                ? t(
                    "Cette page est vide : revenez au début de la liste.",
                    "This page is empty: go back to the start of the list.",
                  )
                : gerer
                  ? t(
                      "Copiez un gabarit CabinetPilot ci-dessous, ou créez un modèle vierge.",
                      "Copy a CabinetPilot template below, or create a blank template.",
                    )
                  : t(
                      "Un consultant, un chef de mission ou un associé doit d'abord en créer un.",
                      "A consultant, an engagement manager or a partner must create one first.",
                    )}
            </p>
          </EtatVide>
        ) : (
          <>
            <ul
              className="mp-liste-lignes"
              aria-label={t("Modèles de questionnaire", "Questionnaire templates")}
            >
              {modeles.donnees.elements.map((m) => (
                <li key={m.id} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <Link href={`/questionnaires/${m.id}`} className="mp-coupure">
                      <strong>{m.titre}</strong>
                    </Link>
                    <span className="mp-texte-doux mp-texte-petit">
                      {t(
                        `Code ${m.code} · ${origineModele(m.origine)} · modifié le ${formaterDateHeure(m.modifie_le)}`,
                        `Code ${m.code} · ${origineModele(m.origine, langue)} · edited on ${formaterDateHeure(m.modifie_le, undefined, langue)}`,
                      )}
                    </span>
                  </span>
                  <span className="mp-badges">
                    {m.version_validee_id ? (
                      <BadgeStatut tonalite="succes">
                        {t("Version validée, envoyable", "Approved version, can be sent")}
                      </BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="neutre">
                        {t("Aucune version validée", "No approved version")}
                      </BadgeStatut>
                    )}
                    {m.brouillon ? (
                      <BadgeStatut tonalite="attention">
                        {t("Brouillon en cours", "Draft in progress")}
                      </BadgeStatut>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <PaginationCurseur
              libelle={t("Pages des modèles de questionnaire", "Questionnaire template pages")}
              hrefSuivante={
                modeles.donnees.curseur_suivant
                  ? hrefAvecCurseur(BASE, modeles.donnees.curseur_suivant)
                  : null
              }
              hrefDebut={curseur ? BASE : null}
            />
          </>
        )}
      </section>

      <section className="mp-pile" aria-labelledby="titre-gabarits">
        <h2 id="titre-gabarits" className="mp-section__titre">
          {t("Gabarits CabinetPilot", "CabinetPilot templates")}
        </h2>
        <p className="mp-texte-doux">
          {t(
            "Points de départ génériques, fondés sur des principes publics : copiés dans le cabinet, ils deviennent des modèles modifiables (version 1 en brouillon), à adapter et à faire valider par vos experts.",
            "Generic starting points, based on public principles: once copied into the firm, they become editable templates (version 1 as a draft), to adapt and have approved by your experts.",
          )}
        </p>
        {!gabarits.ok ? (
          <EtatErreur
            titre={t(
              "Les gabarits n'ont pas pu être chargés.",
              "The templates could not be loaded.",
            )}
            message={gabarits.message}
            hrefReessayer={hrefAvecCurseur(BASE, curseur)}
          />
        ) : gabarits.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucun gabarit disponible.", "No template available.")}
            icone="livre"
          />
        ) : (
          <ul className="mp-liste-cartes mp-liste-cartes--grille">
            {gabarits.donnees.elements.map((g) => (
              <li key={g.code}>
                <Carte
                  niveauTitre={3}
                  titre={g.titre}
                  piedDePage={
                    gerer ? (
                      <Link
                        href={`/questionnaires/nouveau?gabarit=${encodeURIComponent(g.code)}`}
                        className={classesBouton("secondaire")}
                        aria-label={t(
                          `Créer une copie modifiable de « ${g.titre} »`,
                          `Create an editable copy of "${g.titre}"`,
                        )}
                      >
                        <Icone nom="copie" />
                        <span>{t("Créer une copie modifiable", "Create an editable copy")}</span>
                      </Link>
                    ) : null
                  }
                >
                  <p className="mp-texte-doux">
                    {`${formaterNombre(g.sections, 2, langue)} section${g.sections > 1 ? "s" : ""} · ${formaterNombre(g.questions, 2, langue)} question${g.questions > 1 ? "s" : ""}`}
                  </p>
                </Carte>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
