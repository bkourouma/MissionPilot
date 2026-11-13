import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { chargerServeur } from "../../../../lib/api-serveur";
import { construireArbre, libelleMode, type TypeMissionDetaille } from "../../../../lib/catalogue";
import type { Grade } from "../../../../lib/collaborateurs";
import { formaterNombre } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { exigerPermission } from "../../../../lib/session";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { ActionsType } from "./ActionsType";
import { ArbreModele } from "./ArbreModele";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Type de mission", "Engagement type") };
}

export default async function PageTypeMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const tr = await obtenirT();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("catalogue.lire");
  const peutEcrire = aPermission(utilisateur.roles, "catalogue.ecrire");
  const [r, grades] = await Promise.all([
    chargerServeur<TypeMissionDetaille>(`/api/types-mission/${id}`),
    chargerServeur<{ elements: Grade[] }>("/api/grades"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={tr("Type de mission", "Engagement type")}
          retour={{ href: "/catalogue", libelle: tr("Catalogue", "Catalog") }}
        />
        <EtatErreur
          titre={tr(
            "Le type de mission n'a pas pu être chargé.",
            "The engagement type could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/catalogue/${id}`}
        />
      </div>
    );
  }
  const t = r.donnees;
  const listeGrades = grades.ok ? grades.donnees.elements : [];
  const libelleGrade = (code: string) => listeGrades.find((g) => g.code === code)?.libelle ?? code;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t.libelle}
        retour={{ href: "/catalogue", libelle: tr("Catalogue", "Catalog") }}
        soustitre={[t.domaine, libelleMode(t.mode_facturation, langue)].filter(Boolean).join(" · ")}
        badges={
          <>
            {t.a_valider ? (
              <BadgeStatut tonalite="attention">
                {tr("Valeurs de départ à valider", "Starting values pending approval")}
              </BadgeStatut>
            ) : null}
            {t.actif ? null : (
              <BadgeStatut tonalite="neutre">{tr("Archivé", "Archived")}</BadgeStatut>
            )}
          </>
        }
        actions={
          peutEcrire ? (
            <Link href={`/catalogue/${t.id}/modifier`} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>{tr("Modifier", "Edit")}</span>
            </Link>
          ) : null
        }
      />

      {peutEcrire ? <ActionsType type={t} /> : null}

      <Carte titre={tr("Caractéristiques", "Characteristics")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{tr("Code", "Code")}</dt>
            <dd>
              <code>{t.code}</code>
            </dd>
          </div>
          <div>
            <dt>{tr("Domaine", "Domain")}</dt>
            <dd>{t.domaine ?? "—"}</dd>
          </div>
          <div>
            <dt>{tr("Mode de facturation", "Billing mode")}</dt>
            <dd>{libelleMode(t.mode_facturation, langue)}</dd>
          </div>
          <div>
            <dt>{tr("Durée type", "Typical duration")}</dt>
            <dd>
              {t.duree_type_jours === null
                ? "—"
                : `${formaterNombre(t.duree_type_jours, 2, langue)} ${tr("jours calendaires", "calendar days")}`}
            </dd>
          </div>
          <div>
            <dt>{tr("Équipe type", "Typical team")}</dt>
            <dd>
              {t.equipe_type.length === 0
                ? "—"
                : t.equipe_type
                    .map((m) => `${m.nombre} × ${libelleGrade(m.grade_code)}`)
                    .join(", ")}
            </dd>
          </div>
        </dl>
      </Carte>

      <section aria-labelledby="titre-modele" className="mp-pile">
        <h2 id="titre-modele" className="mp-section__titre">
          {tr("Découpage type", "Typical work breakdown")}
        </h2>
        <p className="mp-texte-doux">
          {tr(
            "Phases, lots et tâches pré-remplis à la création d'une mission de ce type, avec les jours types par grade.",
            "Phases, work packages and tasks prefilled when an engagement of this type is created, with typical days per grade.",
          )}
        </p>
        {!grades.ok ? (
          <EtatErreur
            titre={tr("Les grades n'ont pas pu être chargés.", "The grades could not be loaded.")}
            message={grades.message}
            hrefReessayer={`/catalogue/${id}`}
          />
        ) : null}
        <ArbreModele
          typeId={t.id}
          arbre={construireArbre(t.elements)}
          grades={listeGrades.map((g) => ({ code: g.code, libelle: g.libelle }))}
          peutEcrire={peutEcrire}
        />
      </section>
    </div>
  );
}
