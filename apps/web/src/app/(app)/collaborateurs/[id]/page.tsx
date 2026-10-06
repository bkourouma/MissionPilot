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
import {
  droitsReferentiel,
  TYPE_LIBELLES,
  type Collaborateur,
} from "../../../../lib/collaborateurs";
import { formaterPourcentage } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { exigerPermission } from "../../../../lib/session";
import { ArchivageCollaborateur } from "./ArchivageCollaborateur";
import { SectionCouts } from "./SectionCouts";

export const metadata: Metadata = { title: "Fiche collaborateur" };

const liste = (l: string[]) => (l.length ? l.join(", ") : "—");

export default async function PageCollaborateur({ params }: { params: Promise<{ id: string }> }) {
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
          titre="Fiche collaborateur"
          retour={{ href: "/collaborateurs", libelle: "Collaborateurs" }}
        />
        <EtatErreur
          titre="La fiche du collaborateur n'a pas pu être chargée."
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
        retour={{ href: "/collaborateurs", libelle: "Collaborateurs" }}
        soustitre={[c.grade_libelle, TYPE_LIBELLES[c.type]].filter(Boolean).join(" · ")}
        badges={
          c.actif ? (
            <BadgeStatut tonalite="succes">Actif</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">Archivé</BadgeStatut>
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
                <span>Modifier</span>
              </Link>
              <ArchivageCollaborateur collaborateur={c} />
            </>
          ) : null
        }
      />

      <Carte titre="Profil">
        <dl className="mp-liste-def">
          <div>
            <dt>Grade</dt>
            <dd>{c.grade_libelle ?? "Sans grade"}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{TYPE_LIBELLES[c.type]}</dd>
          </div>
          <div>
            <dt>Capacité</dt>
            <dd>
              {formaterPourcentage(c.capacite_pct / 100)} du temps disponible pour les missions
            </dd>
          </div>
          <div>
            <dt>Compétences</dt>
            <dd>{liste(c.competences)}</dd>
          </div>
          <div>
            <dt>Secteurs</dt>
            <dd>{liste(c.secteurs)}</dd>
          </div>
          <div>
            <dt>Langues</dt>
            <dd>{liste(c.langues)}</dd>
          </div>
          <div>
            <dt>Compte utilisateur</dt>
            <dd>
              {c.utilisateur_id ? "Rattaché à un compte MissionPilot" : "Aucun compte rattaché"}
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
