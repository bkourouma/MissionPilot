import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BoutonAction } from "../../../../../components/methodes/BoutonAction";
import { FormulaireBrique } from "../../../../../components/methodes/FormulaireBrique";
import { FormulaireElement } from "../../../../../components/methodes/FormulaireElement";
import { FormulaireEtape } from "../../../../../components/methodes/FormulaireEtape";
import { FormulaireRegle } from "../../../../../components/methodes/FormulaireRegle";
import { NotesVersion } from "../../../../../components/methodes/NotesVersion";
import { ContenuVersion } from "../../../../../components/methodes/VuesMethode";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
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
        actions={<Link href={hrefSimulateur(v.version.id)}>Simuler les règles</Link>}
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
        {!val.ok ? (
          <p>{val.message}</p>
        ) : (
          <div className="mp-pile">
            <p>
              {val.donnees.valide
                ? "Version cohérente : règles valides, cas types réussis."
                : "Version incohérente : corriger les erreurs avant publication."}
              {val.donnees.cas_types
                ? ` Cas types : ${val.donnees.cas_types.reussis} réussi(s), ${val.donnees.cas_types.echoues} échoué(s).`
                : ""}
            </p>
            {val.donnees.anomalies.length > 0 ? (
              <ul className="mp-liste-simple">
                {val.donnees.anomalies.map((a, i) => (
                  <li key={i}>
                    <BadgeStatut tonalite={a.gravite === "erreur" ? "danger" : "attention"}>
                      {a.gravite === "erreur" ? "Erreur" : "Avertissement"}
                    </BadgeStatut>{" "}
                    {a.message} <span className="mp-methode__code">({a.chemin})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Carte>

      {editable ? (
        <Carte titre="Publier">
          <div className="mp-pile">
            <NotesVersion versionId={v.version.id} notes={v.version.notes_version} />
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
          </div>
        </Carte>
      ) : v.version.statut === "brouillon" && v.methode.origine !== "standard" ? (
        <p>Brouillon : seul un expert métier ou un associé le modifie et le publie.</p>
      ) : null}

      <ContenuVersion v={v} facteurs={facteurs} editable={editable} />

      {editable ? (
        <div className="mp-pile">
          <Carte titre="Ajouter une étape">
            <FormulaireEtape versionId={v.version.id} />
          </Carte>
          {v.etapes.length > 0 ? (
            <Carte titre="Ajouter une brique">
              <FormulaireBrique versionId={v.version.id} etapes={v.etapes} />
            </Carte>
          ) : null}
          <Carte titre="Ajouter une règle de contexte">
            <FormulaireRegle
              versionId={v.version.id}
              facteurs={facteurs}
              briques={v.briques.map((b) => ({ code: b.code, libelle: b.libelle }))}
            />
          </Carte>
          <Carte titre="Ajouter un livrable, un item, un KPI type…">
            <FormulaireElement
              versionId={v.version.id}
              briques={v.briques.map((b) => ({ id: b.id, libelle: b.libelle }))}
            />
          </Carte>
        </div>
      ) : null}
    </div>
  );
}
