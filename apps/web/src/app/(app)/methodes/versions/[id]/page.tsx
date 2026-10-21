import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BoutonAction } from "../../../../../components/methodes/BoutonAction";
import { AjoutsVersion } from "../../../../../components/methodes/AjoutsVersion";
import { ControleCoherence } from "../../../../../components/methodes/ControleCoherence";
import { NotesVersion } from "../../../../../components/methodes/NotesVersion";
import { ContenuVersion } from "../../../../../components/methodes/VuesMethode";
import { Alerte } from "../../../../../components/ui/Alerte";
import { Bouton } from "../../../../../components/ui/Bouton";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  hrefApercu,
  hrefMethode,
  hrefSimulateur,
  hrefVersion,
  libelleOrigine,
  peutGerer,
  resumeDifferences,
  type Differences,
  type Facteur,
  type ValidationVersion,
  type VersionDetail,
} from "../../../../../lib/methodes";
import { raisonPublicationBloquee } from "../../../../../lib/methodes-coherence";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Version de méthode" };

interface MiseAJour {
  disponible: boolean;
  standard?: { version: number; notes_version: string | null };
  evolutions_standard?: Differences;
  ecarts_cabinet?: Differences;
  conflits?: { collection: string; code: string }[];
}

/**
 * Version d'une méthode : étapes et briques, règles décrites en français, éléments,
 * rubriques ; différences avec le standard (variante) ou la version précédente ; contrôle de
 * cohérence ; éditeur sans code et publication pour un brouillon du cabinet (STD-11).
 */
export default async function PageVersionMethode({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("standard.lire");
  const [r, f, val] = await Promise.all([
    chargerServeur<VersionDetail>(`/api/methodes/versions/${id}`),
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
    chargerServeur<ValidationVersion>(`/api/methodes/versions/${id}/validation`),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Version de méthode"
          retour={{ href: "/methodes", libelle: "Méthodes" }}
        />
        <EtatErreur
          titre="La version n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefVersion(id)}
        />
      </div>
    );
  }
  const v = r.donnees;
  const facteurs = f.ok ? f.donnees.elements : [];
  const editable = v.modifiable && peutGerer(utilisateur.roles);
  const raisonPublication = raisonPublicationBloquee(val.ok ? val.donnees : null);
  const maj =
    v.methode.origine === "variante"
      ? await chargerServeur<MiseAJour>(`/api/methodes/versions/${id}/mise-a-jour`)
      : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${v.methode.libelle} — version ${v.version.version}`}
        retour={{ href: hrefMethode(v.methode.id), libelle: v.methode.libelle }}
        soustitre={v.version.notes_version ?? undefined}
        badges={
          <>
            <BadgeStatut tonalite={v.version.statut === "publiee" ? "succes" : "attention"}>
              {v.version.statut === "publiee" ? "Publiée" : "Brouillon"}
            </BadgeStatut>
            <BadgeStatut tonalite="neutre">{libelleOrigine(v.methode.origine)}</BadgeStatut>
          </>
        }
        actions={
          <>
            <Link href={hrefApercu(v.version.id)}>Aperçu de la mission</Link>
            <Link href={hrefSimulateur(v.version.id)}>Simuler les règles</Link>
          </>
        }
      />

      {v.differences ? (
        <Carte
          titre={
            v.differences.reference.nature === "standard"
              ? `Différences avec le standard (version ${v.differences.reference.version})`
              : `Différences avec la version ${v.differences.reference.version}`
          }
        >
          {v.differences.diff.identique ? (
            <p>Aucune différence.</p>
          ) : (
            <ul className="mp-liste-simple">
              {resumeDifferences(v.differences.diff).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </Carte>
      ) : null}

      {maj?.ok && maj.donnees.disponible ? (
        <section id="mise-a-jour">
          <Alerte
            tonalite="info"
            titre={`Mise à jour du standard : version ${maj.donnees.standard?.version}`}
          >
            {maj.donnees.standard?.notes_version ? (
              <p>{maj.donnees.standard.notes_version}</p>
            ) : null}
            <p>Évolutions du standard :</p>
            <ul className="mp-liste-simple">
              {resumeDifferences(maj.donnees.evolutions_standard!).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {maj.donnees.conflits && maj.donnees.conflits.length > 0 ? (
              <p>
                À arbitrer (modifiés par le cabinet ET par le standard ; le choix du cabinet sera
                conservé) : {maj.donnees.conflits.map((c) => c.code).join(", ")}.
              </p>
            ) : (
              <p>Aucun conflit avec les choix du cabinet.</p>
            )}
          </Alerte>
        </section>
      ) : null}

      <Carte titre="Contrôle de cohérence">
        {!val.ok ? <p>{val.message}</p> : <ControleCoherence validation={val.donnees} />}
      </Carte>

      {editable ? (
        <Carte titre="Publier">
          <div className="mp-pile">
            <NotesVersion versionId={v.version.id} notes={v.version.notes_version} />
            {raisonPublication ? (
              <div className="mp-pile">
                <Bouton
                  variante="primaire"
                  icone="succes"
                  disabled
                  aria-describedby="raison-publication"
                >
                  Publier cette version
                </Bouton>
                <p id="raison-publication" className="mp-champ__erreur">
                  {raisonPublication}
                </p>
              </div>
            ) : (
              <BoutonAction
                libelle="Publier cette version"
                chemin={`/api/methodes/versions/${v.version.id}/publication`}
                variante="primaire"
                icone="succes"
                confirmation={{
                  question: "Publier ? Une version publiée ne se modifie plus.",
                  libelleConfirmation: "Oui, publier",
                }}
              />
            )}
          </div>
        </Carte>
      ) : v.version.statut === "brouillon" && v.methode.origine !== "standard" ? (
        <p>Brouillon : seul un expert métier ou un associé le modifie et le publie.</p>
      ) : null}

      <ContenuVersion v={v} facteurs={facteurs} editable={editable} />

      {editable ? <AjoutsVersion v={v} facteurs={facteurs} /> : null}
    </div>
  );
}
