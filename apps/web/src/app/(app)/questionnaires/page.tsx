import Link from "next/link";
import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Questionnaires" };

const BASE = "/questionnaires";

/**
 * Modèles de questionnaires du cabinet (SOC-10) : liste paginée, gabarits génériques de
 * MissionPilot à copier, création d'un modèle.
 */
export default async function PageQuestionnaires({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
        titre="Questionnaires"
        soustitre="Modèles du cabinet, versionnés : une version validée est figée et s'envoie aux répondants du client depuis l'onglet « Questionnaires » d'une mission."
        actions={
          gerer ? (
            <>
              {genererIa ? (
                <Link href="/questionnaires/generation-ia" className={classesBouton("secondaire")}>
                  <Icone nom="plus" />
                  <span>Générer avec l&apos;IA</span>
                </Link>
              ) : null}
              <Link href="/questionnaires/nouveau" className={classesBouton("primaire")}>
                <Icone nom="plus" />
                <span>Nouveau modèle</span>
              </Link>
            </>
          ) : null
        }
      />

      <section className="mp-pile" aria-labelledby="titre-modeles">
        <h2 id="titre-modeles" className="mp-section__titre">
          Modèles du cabinet
        </h2>
        {!modeles.ok ? (
          <EtatErreur
            titre="Les modèles de questionnaire n'ont pas pu être chargés."
            message={modeles.message}
            hrefReessayer={hrefAvecCurseur(BASE, curseur)}
          />
        ) : modeles.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun modèle de questionnaire." icone="bulle">
            <p>
              {curseur
                ? "Cette page est vide : revenez au début de la liste."
                : gerer
                  ? "Copiez un gabarit MissionPilot ci-dessous, ou créez un modèle vierge."
                  : "Un consultant, un chef de mission ou un associé doit d'abord en créer un."}
            </p>
          </EtatVide>
        ) : (
          <>
            <ul className="mp-liste-lignes" aria-label="Modèles de questionnaire">
              {modeles.donnees.elements.map((m) => (
                <li key={m.id} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <Link href={`/questionnaires/${m.id}`} className="mp-coupure">
                      <strong>{m.titre}</strong>
                    </Link>
                    <span className="mp-texte-doux mp-texte-petit">
                      {`Code ${m.code} · ${origineModele(m.origine)} · modifié le ${formaterDateHeure(m.modifie_le)}`}
                    </span>
                  </span>
                  <span className="mp-badges">
                    {m.version_validee_id ? (
                      <BadgeStatut tonalite="succes">Version validée, envoyable</BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="neutre">Aucune version validée</BadgeStatut>
                    )}
                    {m.brouillon ? (
                      <BadgeStatut tonalite="attention">Brouillon en cours</BadgeStatut>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <PaginationCurseur
              libelle="Pages des modèles de questionnaire"
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
          Gabarits MissionPilot
        </h2>
        <p className="mp-texte-doux">
          Points de départ génériques, fondés sur des principes publics : copiés dans le cabinet,
          ils deviennent des modèles modifiables (version 1 en brouillon), à adapter et à faire
          valider par vos experts.
        </p>
        {!gabarits.ok ? (
          <EtatErreur
            titre="Les gabarits n'ont pas pu être chargés."
            message={gabarits.message}
            hrefReessayer={hrefAvecCurseur(BASE, curseur)}
          />
        ) : gabarits.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun gabarit disponible." icone="livre" />
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
                        aria-label={`Créer une copie modifiable de « ${g.titre} »`}
                      >
                        <Icone nom="copie" />
                        <span>Créer une copie modifiable</span>
                      </Link>
                    ) : null
                  }
                >
                  <p className="mp-texte-doux">
                    {`${formaterNombre(g.sections)} section${g.sections > 1 ? "s" : ""} · ${formaterNombre(g.questions)} question${g.questions > 1 ? "s" : ""}`}
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
