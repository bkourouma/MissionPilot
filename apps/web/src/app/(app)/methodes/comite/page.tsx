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
import { lireCurseur, peutGerer, type PageMethodes } from "../../../../lib/methodes";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Comité méthode" };

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
      libelle: `${x.libelle} — version ${x.derniere_publiee!.version}`,
    }));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Comité méthode"
        soustitre="Circuit de proposition, revue et publication des évolutions du référentiel. Le standard MissionPilot lui-même évolue par ACC ; une proposition acceptée se publie dans la variante du cabinet."
      />
      {gerer ? (
        <Carte titre="Proposer une évolution">
          <FormulaireProposition
            methodes={methodes.map((x) => ({ id: x.id, libelle: x.libelle }))}
          />
        </Carte>
      ) : null}
      {!r.ok ? (
        <EtatErreur
          titre="Les propositions n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={href(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune proposition." icone="bulle" />
      ) : (
        <ul className="mp-liste-cartes">
          {r.donnees.elements.map((p) => (
            <li key={p.id}>
              <Carte titre={p.titre} niveauTitre={3}>
                <div className="mp-pile">
                  <div className="mp-badges">
                    <BadgeStatut tonalite={TONALITES[p.statut]}>
                      {STATUT_PROPOSITION_LIBELLES[p.statut]}
                    </BadgeStatut>
                    {p.methode_libelle ? (
                      <BadgeStatut tonalite="neutre">
                        {p.methode_libelle}
                        {p.methode_standard ? " (standard)" : ""}
                      </BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="neutre">Nouvelle méthode</BadgeStatut>
                    )}
                  </div>
                  <p>{p.description}</p>
                  <p className="mp-texte-doux mp-texte-petit">
                    Proposée le {formaterDate(p.cree_le)}
                    {p.auteur_nom ? ` par ${p.auteur_nom}` : ""}
                    {p.relecteur_nom ? ` · relecteur : ${p.relecteur_nom}` : ""}
                  </p>
                  {p.avis ? <p>Avis : {p.avis}</p> : null}
                  {gerer && p.statut === "proposee" && p.auteur_id !== utilisateur.id ? (
                    <BoutonAction
                      libelle="Prendre en revue"
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
                        Publiez d&apos;abord une version de la variante qui porte cette évolution.
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
          libelle="Pages des propositions"
          hrefSuivante={r.donnees.curseur_suivant ? href(r.donnees.curseur_suivant) : null}
          hrefDebut={curseur ? href() : null}
        />
      ) : null}
    </div>
  );
}
