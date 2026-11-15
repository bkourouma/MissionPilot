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
import { obtenirLangue } from "../../../lib/i18n/serveur";
import {
  hrefListe,
  lireParametresListe,
  requeteApiListe,
  type PageListe,
} from "../../../lib/clients";
import {
  droitsReferentiel,
  lireTypeFiltre,
  libelleTypeCollaborateur,
  optionsTypes,
  type Collaborateur,
} from "../../../lib/collaborateurs";
import { formaterPourcentage } from "../../../lib/format";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Team members" : "Collaborateurs" };
}

export default async function PageCollaborateurs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("collaborateurs.lire");
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
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
        titre={t("Collaborateurs", "Team members")}
        soustitre={t(
          "Grade, compétences, langues et capacité de chaque membre de l'équipe.",
          "Grade, skills, languages and capacity of each team member.",
        )}
        actions={
          droits.ecrireCollaborateurs ? (
            <Link href="/collaborateurs/nouveau" className={classesBouton("primaire")}>
              <Icone nom="plus" />
              <span>{t("Nouveau collaborateur", "New team member")}</span>
            </Link>
          ) : null
        }
      />

      <BarreRecherche
        action="/collaborateurs"
        params={params}
        libelleRecherche={t("Rechercher un collaborateur", "Search for a team member")}
        aideRecherche={t("Nom, compétence ou secteur.", "Name, skill or sector.")}
        autres={
          <Select
            libelle={t("Type", "Type")}
            name="type"
            invite={t("Tous", "All")}
            options={optionsTypes(langue)}
            defaultValue={type ?? ""}
          />
        }
      />

      {!page.ok ? (
        <EtatErreur
          titre={t(
            "La liste des collaborateurs n'a pas pu être chargée.",
            "The list of team members could not be loaded.",
          )}
          message={page.message}
          hrefReessayer={lien(params.curseur)}
        />
      ) : page.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t(
                  "Aucun collaborateur ne correspond à votre recherche.",
                  "No team member matches your search.",
                )
              : t("Aucun collaborateur pour l'instant.", "No team members yet.")
          }
          icone="personnes"
          action={
            filtre ? (
              <Link href="/collaborateurs" className={classesBouton("secondaire")}>
                {t("Effacer la recherche", "Clear search")}
              </Link>
            ) : droits.ecrireCollaborateurs ? (
              <Link href="/collaborateurs/nouveau" className={classesBouton("primaire")}>
                {t("Ajouter le premier collaborateur", "Add the first team member")}
              </Link>
            ) : null
          }
        />
      ) : (
        <Tableau
          legende={t("Liste des collaborateurs", "List of team members")}
          lignes={page.donnees.elements}
          cleLigne={(c) => c.id}
          colonnes={[
            {
              cle: "nom",
              entete: t("Nom", "Name"),
              rendu: (c) => (
                <Link href={`/collaborateurs/${c.id}`} className="mp-lien-ligne">
                  {c.nom}
                </Link>
              ),
            },
            { cle: "grade", entete: t("Grade", "Grade"), rendu: (c) => c.grade_libelle ?? "—" },
            {
              cle: "type",
              entete: t("Type", "Type"),
              rendu: (c) => libelleTypeCollaborateur(c.type, langue),
            },
            {
              cle: "competences",
              entete: t("Compétences", "Skills"),
              rendu: (c) => (c.competences.length ? c.competences.join(", ") : "—"),
            },
            {
              cle: "capacite",
              entete: t("Capacité", "Capacity"),
              alignement: "droite",
              rendu: (c) => formaterPourcentage(c.capacite_pct / 100, 1, langue),
            },
            {
              cle: "actif",
              entete: t("Statut", "Status"),
              rendu: (c) =>
                c.actif ? (
                  <BadgeStatut tonalite="succes">{t("Actif", "Active")}</BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="neutre">{t("Archivé", "Archived")}</BadgeStatut>
                ),
            },
          ]}
        />
      )}

      {page.ok ? (
        <PaginationCurseur
          libelle={t("Pagination des collaborateurs", "Team member pagination")}
          hrefDebut={params.curseur ? lien() : null}
          hrefSuivante={page.donnees.curseur_suivant ? lien(page.donnees.curseur_suivant) : null}
        />
      ) : null}
    </div>
  );
}
