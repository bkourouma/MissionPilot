import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { Tableau } from "../../../components/ui/Tableau";
import { BarreRecherche } from "../../../components/referentiels/BarreRecherche";
import { chargerServeur } from "../../../lib/api-serveur";
import {
  hrefListe,
  lireParametresListe,
  requeteApiListe,
  type PageListe,
} from "../../../lib/clients";
import {
  droitsReferentiel,
  lireTypeFiltre,
  OPTIONS_TYPES,
  TYPE_LIBELLES,
  type Collaborateur,
} from "../../../lib/collaborateurs";
import { formaterPourcentage } from "../../../lib/format";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Collaborateurs" };

export default async function PageCollaborateurs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("collaborateurs.lire");
  const droits = droitsReferentiel(utilisateur.roles);
  const brut = await searchParams;
  const params = lireParametresListe(brut);
  const type = lireTypeFiltre(brut.type);
  const extra: Record<string, string> = type ? { type } : {};
  const requete = requeteApiListe(params, 50) + (type ? `&type=${type}` : "");
  // Référentiel sans aucune donnée financière (FIN-02) : coûts et taux sont sur la fiche.
  const page = await chargerServeur<PageListe<Collaborateur>>(`/api/collaborateurs?${requete}`);
  const filtre = Boolean(params.q) || params.statut !== "actifs" || Boolean(type);
  const lien = (curseur?: string) => hrefListe("/collaborateurs", { ...params, curseur }, extra);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Collaborateurs"
        soustitre="Grade, compétences, langues et capacité de chaque membre de l'équipe."
        actions={
          droits.ecrireCollaborateurs ? (
            <Link href="/collaborateurs/nouveau" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>Nouveau collaborateur</span>
            </Link>
          ) : null
        }
      />

      <BarreRecherche
        action="/collaborateurs"
        params={params}
        libelleRecherche="Rechercher un collaborateur"
        aideRecherche="Nom, compétence ou secteur."
        autres={
          <Select
            libelle="Type"
            name="type"
            invite="Tous"
            options={OPTIONS_TYPES}
            defaultValue={type ?? ""}
          />
        }
      />

      {!page.ok ? (
        <EtatErreur
          titre="La liste des collaborateurs n'a pas pu être chargée."
          message={page.message}
          hrefReessayer={lien(params.curseur)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? "Aucun collaborateur ne correspond à votre recherche."
              : "Aucun collaborateur pour l'instant."
          }
          icone="personnes"
          action={
            filtre ? (
              <Link href="/collaborateurs" className={classesBouton("secondaire")}>
                Effacer la recherche
              </Link>
            ) : droits.ecrireCollaborateurs ? (
              <Link href="/collaborateurs/nouveau" className={classesBouton("primaire")}>
                Ajouter le premier collaborateur
              </Link>
            ) : null
          }
        />
      ) : (
        <Tableau
          legende="Liste des collaborateurs"
          lignes={page.donnees.elements}
          cleLigne={(c) => c.id}
          colonnes={[
            {
              cle: "nom",
              entete: "Nom",
              rendu: (c) => (
                <Link href={`/collaborateurs/${c.id}`} className="mp-lien-ligne">
                  {c.nom}
                </Link>
              ),
            },
            { cle: "grade", entete: "Grade", rendu: (c) => c.grade_libelle ?? "—" },
            { cle: "type", entete: "Type", rendu: (c) => TYPE_LIBELLES[c.type] },
            {
              cle: "competences",
              entete: "Compétences",
              rendu: (c) => (c.competences.length ? c.competences.join(", ") : "—"),
            },
            {
              cle: "capacite",
              entete: "Capacité",
              alignement: "droite",
              rendu: (c) => formaterPourcentage(c.capacite_pct / 100),
            },
            {
              cle: "actif",
              entete: "Statut",
              rendu: (c) =>
                c.actif ? (
                  <BadgeStatut tonalite="succes">Actif</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">Archivé</BadgeStatut>
                ),
            },
          ]}
        />
      )}

      {page.ok ? (
        <PaginationCurseur
          libelle="Pagination des collaborateurs"
          hrefDebut={params.curseur ? lien() : null}
          hrefSuivante={page.donnees.curseur_suivant ? lien(page.donnees.curseur_suivant) : null}
        />
      ) : null}
    </div>
  );
}
