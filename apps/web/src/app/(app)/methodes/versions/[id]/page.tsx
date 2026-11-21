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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { hrefAmorcage } from "../../../../../lib/ingestion";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Version de méthode", "Method version") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          titre={t("Version de méthode", "Method version")}
          retour={{ href: "/methodes", libelle: t("Méthodes", "Methods") }}
        />
        <EtatErreur
          titre={t("La version n'a pas pu être chargée.", "The version could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefVersion(id)}
        />
      </div>
    );
  }
  const v = r.donnees;
  const facteurs = f.ok ? f.donnees.elements : [];
  const editable = v.modifiable && peutGerer(utilisateur.roles);
  const raisonPublication = raisonPublicationBloquee(val.ok ? val.donnees : null, langue);
  const maj =
    v.methode.origine === "variante"
      ? await chargerServeur<MiseAJour>(`/api/methodes/versions/${id}/mise-a-jour`)
      : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${v.methode.libelle} — ${t("version", "version")} ${v.version.version}`}
        retour={{ href: hrefMethode(v.methode.id), libelle: v.methode.libelle }}
        soustitre={v.version.notes_version ?? undefined}
        badges={
          <>
            <BadgeStatut tonalite={v.version.statut === "publiee" ? "succes" : "attention"}>
              {v.version.statut === "publiee" ? t("Publiée", "Published") : t("Brouillon", "Draft")}
            </BadgeStatut>
            <BadgeStatut tonalite="neutre">{libelleOrigine(v.methode.origine, langue)}</BadgeStatut>
          </>
        }
        actions={
          <>
            <Link href={hrefApercu(v.version.id)}>
              {t("Aperçu de la mission", "Engagement preview")}
            </Link>
            <Link href={hrefSimulateur(v.version.id)}>
              {t("Simuler les règles", "Simulate the rules")}
            </Link>
            {peutGerer(utilisateur.roles) && v.methode.cabinet_id !== null ? (
              <Link href={hrefAmorcage(v.version.id)}>
                {t("Amorçage depuis des documents", "Bootstrap from documents")}
              </Link>
            ) : null}
          </>
        }
      />

      {v.differences ? (
        <Carte
          titre={
            v.differences.reference.nature === "standard"
              ? t(
                  `Différences avec le standard (version ${v.differences.reference.version})`,
                  `Differences from the standard (version ${v.differences.reference.version})`,
                )
              : t(
                  `Différences avec la version ${v.differences.reference.version}`,
                  `Differences from version ${v.differences.reference.version}`,
                )
          }
        >
          {v.differences.diff.identique ? (
            <p>{t("Aucune différence.", "No difference.")}</p>
          ) : (
            <ul className="mp-liste-simple">
              {resumeDifferences(v.differences.diff, langue).map((l) => (
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
            titre={t(
              `Mise à jour du standard : version ${maj.donnees.standard?.version}`,
              `Standard update: version ${maj.donnees.standard?.version}`,
            )}
          >
            {maj.donnees.standard?.notes_version ? (
              <p>{maj.donnees.standard.notes_version}</p>
            ) : null}
            <p>{t("Évolutions du standard :", "Changes to the standard:")}</p>
            <ul className="mp-liste-simple">
              {resumeDifferences(maj.donnees.evolutions_standard!, langue).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {maj.donnees.conflits && maj.donnees.conflits.length > 0 ? (
              <p>
                {t(
                  "À arbitrer (modifiés par le cabinet ET par le standard ; le choix du cabinet sera conservé) : ",
                  "To be decided (changed by both the firm AND the standard; the firm's choice will be kept): ",
                )}
                {maj.donnees.conflits.map((c) => c.code).join(", ")}.
              </p>
            ) : (
              <p>
                {t(
                  "Aucun conflit avec les choix du cabinet.",
                  "No conflict with the firm's choices.",
                )}
              </p>
            )}
          </Alerte>
        </section>
      ) : null}

      <Carte titre={t("Contrôle de cohérence", "Consistency check")}>
        {!val.ok ? (
          <Alerte
            tonalite="danger"
            titre={t(
              "Le contrôle de cohérence n'a pas pu être chargé.",
              "The consistency check could not be loaded.",
            )}
          >
            <p>{val.message}</p>
            <p>
              <Link href={hrefVersion(id)}>{t("Réessayer", "Try again")}</Link>
            </p>
          </Alerte>
        ) : (
          <ControleCoherence validation={val.donnees} />
        )}
      </Carte>

      {editable ? (
        <Carte titre={t("Publier", "Publish")}>
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
                  {t("Publier cette version", "Publish this version")}
                </Bouton>
                <p id="raison-publication" className="mp-champ__erreur">
                  {raisonPublication}
                </p>
              </div>
            ) : (
              <BoutonAction
                libelle={t("Publier cette version", "Publish this version")}
                chemin={`/api/methodes/versions/${v.version.id}/publication`}
                variante="primaire"
                icone="succes"
                confirmation={{
                  question: t(
                    "Publier ? Une version publiée ne se modifie plus.",
                    "Publish? A published version can no longer be edited.",
                  ),
                  libelleConfirmation: t("Oui, publier", "Yes, publish"),
                }}
              />
            )}
          </div>
        </Carte>
      ) : v.version.statut === "brouillon" && v.methode.origine !== "standard" ? (
        <p>
          {t(
            "Brouillon : seul un expert métier ou un associé le modifie et le publie.",
            "Draft: only a domain expert or a partner can edit and publish it.",
          )}
        </p>
      ) : null}

      <ContenuVersion v={v} facteurs={facteurs} editable={editable} />

      {editable ? <AjoutsVersion v={v} facteurs={facteurs} /> : null}
    </div>
  );
}
