import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import {
  droitsReferentiel,
  libelleTypeCollaborateur,
  type Collaborateur,
} from "../../../../lib/collaborateurs";
import { formaterPourcentage } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { exigerPermission } from "../../../../lib/session";
import { ArchivageCollaborateur } from "./ArchivageCollaborateur";
import { SectionCouts } from "./SectionCouts";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Team member profile" : "Fiche collaborateur" };
}

const liste = (l: string[]) => (l.length ? l.join(", ") : "—");

export default async function PageCollaborateur({ params }: { params: Promise<{ id: string }> }) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("collaborateurs.lire");
  const droits = droitsReferentiel(utilisateur.roles);
  const r = await chargerServeur<Collaborateur>(`/api/collaborateurs/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Fiche collaborateur", "Team member profile")}
          retour={{ href: "/collaborateurs", libelle: t("Collaborateurs", "Team members") }}
        />
        <EtatErreur
          titre={t(
            "La fiche du collaborateur n'a pas pu être chargée.",
            "The team member profile could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/collaborateurs/${id}`}
        />
      </div>
    );
  }
  const c = r.donnees;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={c.nom}
        retour={{ href: "/collaborateurs", libelle: t("Collaborateurs", "Team members") }}
        soustitre={[c.grade_libelle, libelleTypeCollaborateur(c.type, langue)]
          .filter(Boolean)
          .join(" · ")}
        badges={
          c.actif ? (
            <BadgeStatut tonalite="succes">{t("Actif", "Active")}</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">{t("Archivé", "Archived")}</BadgeStatut>
          )
        }
        actions={
          droits.ecrireCollaborateurs ? (
            <>
              <Link
                href={`/collaborateurs/${c.id}/modifier`}
                className={classesBouton("secondaire")}
              >
                <Icone nom="crayon" />
                <span>{t("Modifier", "Edit")}</span>
              </Link>
              <ArchivageCollaborateur collaborateur={c} />
            </>
          ) : null
        }
      />

      <Carte titre={t("Profil", "Profile")}>
        <dl className="mp-liste-def">
          <div>
            <dt>Grade</dt>
            <dd>{c.grade_libelle ?? t("Sans grade", "No grade")}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{libelleTypeCollaborateur(c.type, langue)}</dd>
          </div>
          <div>
            <dt>{t("Capacité", "Capacity")}</dt>
            <dd>
              {t(
                `${formaterPourcentage(c.capacite_pct / 100)} du temps disponible pour les missions`,
                `${formaterPourcentage(c.capacite_pct / 100, 1, langue)} of time available for engagements`,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Compétences", "Skills")}</dt>
            <dd>{liste(c.competences)}</dd>
          </div>
          <div>
            <dt>{t("Secteurs", "Sectors")}</dt>
            <dd>{liste(c.secteurs)}</dd>
          </div>
          <div>
            <dt>{t("Langues", "Languages")}</dt>
            <dd>{liste(c.langues)}</dd>
          </div>
          <div>
            <dt>{t("Compte utilisateur", "User account")}</dt>
            <dd>
              {c.utilisateur_id
                ? t("Rattaché à un compte CabinetPilot", "Linked to a CabinetPilot account")
                : t("Aucun compte rattaché", "No linked account")}
            </dd>
          </div>
        </dl>
      </Carte>

      {/*
        Données financières (FIN-02) : la section n'est rendue, et les coûts ne sont chargés,
        que si l'utilisateur a finance.lire. Sans ce droit, rien n'est envoyé au navigateur.
      */}
      {droits.voirFinances ? (
        <SectionCouts collaborateur={c} peutSaisir={droits.gererTaux} />
      ) : null}
    </div>
  );
}
