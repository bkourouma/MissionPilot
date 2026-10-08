import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeContenuIa,
  BadgeEssaiIa,
  BadgeGabaritIa,
  BadgeStatutGenerationIa,
} from "../../../../../components/ia/BadgeContenuIa";
import { PanneauContenuIa } from "../../../../../components/ia/PanneauContenuIa";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { LIMITE_PROMPTS, type PageIa, type PromptIa } from "../../../../../lib/ia";
import {
  cheminGeneration,
  estEssai,
  lireIdGeneration,
  statutConnu,
  type GenerationIa,
} from "../../../../../lib/ia-contenu";
import { exigerPermission } from "../../../../../lib/session";
import { EssaiGeneration } from "./EssaiGeneration";

export const metadata: Metadata = { title: "Essai de génération IA" };

function hrefEssai(p: { generation?: string | null; curseur?: string | null }): string {
  const q = new URLSearchParams();
  if (p.generation) q.set("generation", p.generation);
  if (p.curseur) q.set("curseur", p.curseur);
  const s = q.toString();
  return s ? `/parametres/ia/essai?${s}` : "/parametres/ia/essai";
}

export default async function PageEssaiIa({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("ia.configurer");
  const q = await searchParams;
  const id = lireIdGeneration(q.generation);
  const curseur = typeof q.curseur === "string" && q.curseur !== "" ? q.curseur : null;
  const liste = new URLSearchParams({ limite: "10" });
  if (curseur) liste.set("curseur", curseur);

  const [prompts, recentes, detail] = await Promise.all([
    chargerServeur<PageIa<PromptIa>>(`/api/ia/prompts?limite=${LIMITE_PROMPTS}`),
    chargerServeur<PageIa<GenerationIa>>(`/api/ia/generations?${liste}`),
    id ? chargerServeur<GenerationIa>(cheminGeneration(id)) : Promise.resolve(null),
  ]);
  const exemples = prompts.ok ? prompts.donnees.elements.filter((p) => p.exemple) : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Essai de génération"
        retour={{ href: "/parametres/ia", libelle: "Intelligence artificielle" }}
        soustitre="Testez un prompt d'exemple : le contenu suit le circuit complet (brouillon IA, modification, validation) sans rien envoyer à un client."
      />
      <Carte titre="Nouvel essai">
        {prompts.ok ? (
          <EssaiGeneration prompts={exemples} />
        ) : (
          <EtatErreur
            titre="Les prompts n'ont pas pu être chargés."
            message={prompts.message}
            hrefReessayer="/parametres/ia/essai"
          />
        )}
      </Carte>
      {detail === null ? null : detail.ok ? (
        <PanneauContenuIa
          key={detail.donnees.id}
          generation={detail.donnees}
          utilisateur={{ id: utilisateur.id, roles: utilisateur.roles }}
          titre="Résultat de l'essai"
          niveauTitre={2}
        />
      ) : (
        <EtatErreur
          titre="La génération n'a pas pu être chargée."
          message={detail.message}
          hrefReessayer={hrefEssai({ generation: id })}
        />
      )}
      <Carte titre="Générations récentes">
        {!recentes.ok ? (
          <EtatErreur
            titre="Les générations récentes n'ont pas pu être chargées."
            message={recentes.message}
            hrefReessayer="/parametres/ia/essai"
          />
        ) : recentes.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune génération pour l'instant." />
        ) : (
          <div className="mp-pile">
            <ul className="mp-liste-lignes">
              {recentes.donnees.elements.map((g) => (
                <li key={g.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <Link href={hrefEssai({ generation: g.id, curseur })}>
                      {`« ${g.prompt.nom} », ${formaterDateHeure(g.cree_le)}`}
                    </Link>
                    <span className="mp-texte-petit mp-texte-doux">{`Demandée par ${g.demandeur.nom}`}</span>
                  </div>
                  <span className="mp-badges">
                    <BadgeStatutGenerationIa statut={statutConnu(g.statut)} />
                    <BadgeContenuIa statut={g.statut_contenu} />
                    {g.gabarit ? <BadgeGabaritIa /> : null}
                    {estEssai(g) ? <BadgeEssaiIa /> : null}
                  </span>
                </li>
              ))}
            </ul>
            <PaginationCurseur
              libelle="Pages des générations récentes"
              hrefSuivante={
                recentes.donnees.curseur_suivant
                  ? hrefEssai({ generation: id, curseur: recentes.donnees.curseur_suivant })
                  : null
              }
              hrefDebut={curseur ? hrefEssai({ generation: id }) : null}
            />
          </div>
        )}
      </Carte>
    </div>
  );
}
