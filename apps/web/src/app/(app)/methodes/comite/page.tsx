import type { Metadata } from "next";
import { STATUT_PROPOSITION_LIBELLES, type StatutPropositionStandard } from "@missionpilot/shared";
import { BoutonAction } from "../../../../components/methodes/BoutonAction";
import {
  DecisionProposition,
  FormulaireProposition,
  PublicationProposition,
} from "../../../../components/methodes/DictionnaireComiteFormulaires";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { lireCurseur, peutGerer, type PageMethodes } from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Comité méthode", "Method committee") };
}

interface Proposition {
  id: string;
  methode_id: string | null;
  methode_libelle: string | null;
  methode_standard: boolean | null;
  titre: string;
  description: string;
  statut: StatutPropositionStandard;
  auteur_id: string;
  auteur_nom: string | null;
  relecteur_id: string | null;
  relecteur_nom: string | null;
  avis: string | null;
  cree_le: string;
}

const TONALITES: Record<StatutPropositionStandard, "succes" | "attention" | "danger" | "neutre"> = {
  proposee: "attention",
  en_revue: "attention",
  acceptee: "succes",
  refusee: "danger",
  publiee: "succes",
};

const STATUT_PROPOSITION_LIBELLES_EN: Record<StatutPropositionStandard, string> = {
  proposee: "Proposed",
  en_revue: "Under review",
  acceptee: "Accepted",
  refusee: "Refused",
  publiee: "Published",
};

const href = (curseur?: string | null) =>
  curseur ? `/methodes/comite?curseur=${encodeURIComponent(curseur)}` : "/methodes/comite";

/**
 * Comité méthode (STD-12) : proposer une évolution, la prendre en revue (un autre expert que
 * l'auteur), l'accepter ou la refuser, puis la marquer publiée avec la version qui la porte.
 */
export default async function PageComite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const curseur = lireCurseur((await searchParams).curseur);
  const gerer = peutGerer(utilisateur.roles);
  const [r, m] = await Promise.all([
    chargerServeur<{ elements: Proposition[]; curseur_suivant: string | null }>(
      `/api/standard/propositions?limite=30${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
    ),
    chargerServeur<PageMethodes>("/api/methodes?limite=100"),
  ]);
  const methodes = m.ok ? m.donnees.elements : [];
  const versionsCabinet = methodes
    .filter((x) => x.origine !== "standard" && x.derniere_publiee)
    .map((x) => ({
      id: x.derniere_publiee!.id,
      libelle: `${x.libelle} — ${t("version", "version")} ${x.derniere_publiee!.version}`,
    }));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Comité méthode", "Method committee")}
        soustitre={t(
          "Circuit de proposition, revue et publication des évolutions du référentiel. Le standard CabinetPilot lui-même évolue par ACC ; une proposition acceptée se publie dans la variante du cabinet.",
          "Process for proposing, reviewing and publishing changes to the framework. The CabinetPilot standard itself evolves through ACC; an accepted proposal is published in the firm's variant.",
        )}
      />
      {gerer ? (
        <Carte titre={t("Proposer une évolution", "Propose a change")}>
          <FormulaireProposition
            methodes={methodes.map((x) => ({ id: x.id, libelle: x.libelle }))}
          />
        </Carte>
      ) : null}
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les propositions n'ont pas pu être chargées.",
            "The proposals could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={href(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune proposition.", "No proposal.")} icone="bulle" />
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((p) => (
            <li key={p.id}>
              <Carte titre={p.titre} niveauTitre={3}>
                <div className="mp-pile">
                  <div className="mp-badges">
                    <BadgeStatut tonalite={TONALITES[p.statut]}>
                      {
                        (langue === "en"
                          ? STATUT_PROPOSITION_LIBELLES_EN
                          : STATUT_PROPOSITION_LIBELLES)[p.statut]
                      }
                    </BadgeStatut>
                    {p.methode_libelle ? (
                      <BadgeStatut tonalite="neutre">
                        {p.methode_libelle}
                        {p.methode_standard ? " (standard)" : ""}
                      </BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="neutre">
                        {t("Nouvelle méthode", "New method")}
                      </BadgeStatut>
                    )}
                  </div>
                  <p>{p.description}</p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {t("Proposée le ", "Proposed on ")}
                    {formaterDate(p.cree_le, undefined, langue)}
                    {p.auteur_nom ? t(` par ${p.auteur_nom}`, ` by ${p.auteur_nom}`) : ""}
                    {p.relecteur_nom
                      ? t(` · relecteur : ${p.relecteur_nom}`, ` · reviewer: ${p.relecteur_nom}`)
                      : ""}
                  </p>
                  {p.avis ? (
                    <p>
                      {t("Avis : ", "Opinion: ")}
                      {p.avis}
                    </p>
                  ) : null}
                  {gerer && p.statut === "proposee" && p.auteur_id !== utilisateur.id ? (
                    <BoutonAction
                      libelle={t("Prendre en revue", "Take for review")}
                      chemin={`/api/standard/propositions/${p.id}/revue`}
                      corps={{ action: "prendre_en_revue" }}
                    />
                  ) : null}
                  {gerer && p.statut === "en_revue" && p.relecteur_id === utilisateur.id ? (
                    <DecisionProposition propositionId={p.id} />
                  ) : null}
                  {gerer && p.statut === "acceptee" ? (
                    versionsCabinet.length > 0 ? (
                      <PublicationProposition propositionId={p.id} versions={versionsCabinet} />
                    ) : (
                      <p>
                        {t(
                          "Publiez d'abord une version de la variante qui porte cette évolution.",
                          "First publish a version of the variant that carries this change.",
                        )}
                      </p>
                    )
                  ) : null}
                </div>
              </Carte>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          libelle={t("Pages des propositions", "Proposal pages")}
          hrefSuivante={r.donnees.curseur_suivant ? href(r.donnees.curseur_suivant) : null}
          hrefDebut={curseur ? href() : null}
        />
      ) : null}
    </div>
  );
}
