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
import {
  construireArbre,
  MODE_LIBELLES,
  type TypeMissionDetaille,
} from "../../../../lib/catalogue";
import type { Grade } from "../../../../lib/collaborateurs";
import { formaterNombre } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { exigerPermission } from "../../../../lib/session";
import { ActionsType } from "./ActionsType";
import { ArbreModele } from "./ArbreModele";

export const metadata: Metadata = { title: "Type de mission" };

export default async function PageTypeMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
          titre="Type de mission"
          retour={{ href: "/catalogue", libelle: "Catalogue" }}
        />
        <EtatErreur
          titre="Le type de mission n'a pas pu être chargé."
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
        retour={{ href: "/catalogue", libelle: "Catalogue" }}
        soustitre={[t.domaine, MODE_LIBELLES[t.mode_facturation]].filter(Boolean).join(" · ")}
        badges={
          <>
            {t.a_valider ? (
              <BadgeStatut tonalite="attention">Valeurs de départ à valider</BadgeStatut>
            ) : null}
            {t.actif ? null : <BadgeStatut tonalite="neutre">Archivé</BadgeStatut>}
          </>
        }
        actions={
          peutEcrire ? (
            <Link href={`/catalogue/${t.id}/modifier`} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>Modifier</span>
            </Link>
          ) : null
        }
      />

      {peutEcrire ? <ActionsType type={t} /> : null}

      <Carte titre="Caractéristiques">
        <dl className="mp-liste-def">
          <div>
            <dt>Code</dt>
            <dd>
              <code>{t.code}</code>
            </dd>
          </div>
          <div>
            <dt>Domaine</dt>
            <dd>{t.domaine ?? "—"}</dd>
          </div>
          <div>
            <dt>Mode de facturation</dt>
            <dd>{MODE_LIBELLES[t.mode_facturation]}</dd>
          </div>
          <div>
            <dt>Durée type</dt>
            <dd>
              {t.duree_type_jours === null
                ? "—"
                : `${formaterNombre(t.duree_type_jours)} jours calendaires`}
            </dd>
          </div>
          <div>
            <dt>Équipe type</dt>
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
          Découpage type
        </h2>
        <p className="mp-texte-doux">
          Phases, lots et tâches pré-remplis à la création d&apos;une mission de ce type, avec les
          jours types par grade.
        </p>
        {!grades.ok ? (
          <EtatErreur
            titre="Les grades n'ont pas pu être chargés."
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
