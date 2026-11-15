import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApercuQuestionnaire } from "../../../../../components/questionnaires/ApercuQuestionnaire";
import { EditeurDefinition } from "../../../../../components/questionnaires/EditeurDefinition";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  libelleStatut,
  peutGererQuestionnaires,
  STATUT_VERSION,
  type VersionDetail,
} from "../../../../../lib/questionnaires";
import { libelleContenuIa } from "../../../../../lib/questionnaires-ia";
import { exigerPermission } from "../../../../../lib/session";
import { PanneauIa } from "./PanneauIa";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Version de questionnaire", "Questionnaire version") };
}

/**
 * Version d'un modèle de questionnaire : éditeur si c'est un brouillon et que l'utilisateur
 * rédige (`questionnaire.gerer`), aperçu en lecture seule sinon (version validée = figée).
 */
export default async function PageVersion({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("questionnaire.lire");
  const r = await chargerServeur<VersionDetail>(`/api/questionnaires/versions/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Version de questionnaire", "Questionnaire version")}
          retour={{ href: "/questionnaires", libelle: t("Questionnaires", "Questionnaires") }}
        />
        <EtatErreur
          titre={t("La version n'a pas pu être chargée.", "The version could not be loaded.")}
          message={r.message}
          hrefReessayer={`/questionnaires/versions/${id}`}
        />
      </div>
    );
  }
  const v = r.donnees;
  const statut = libelleStatut(STATUT_VERSION, v.statut, langue);
  const editable = v.statut === "brouillon" && peutGererQuestionnaires(utilisateur.roles);
  const ia = v.ia ?? null;
  const statutIa = ia ? libelleContenuIa(ia.statut_contenu, langue) : null;
  const retour = {
    href: `/questionnaires/${v.modele_id}`,
    libelle: t("Modèle et versions", "Template and versions"),
  };

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={v.definition.titre}
        retour={retour}
        soustitre={t(
          `Code ${v.code} · version ${v.version} · ${
            v.statut === "valide" && v.valide_le
              ? `validée le ${formaterDateHeure(v.valide_le)}`
              : `modifiée le ${formaterDateHeure(v.modifie_le)}`
          }`,
          `Code ${v.code} · version ${v.version} · ${
            v.statut === "valide" && v.valide_le
              ? `approved on ${formaterDateHeure(v.valide_le, undefined, langue)}`
              : `edited on ${formaterDateHeure(v.modifie_le, undefined, langue)}`
          }`,
        )}
        badges={
          <>
            <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            {statutIa ? (
              <BadgeStatut tonalite={statutIa.tonalite}>{statutIa.libelle}</BadgeStatut>
            ) : null}
          </>
        }
      />
      {ia ? <PanneauIa ia={ia} /> : null}
      {editable ? (
        <EditeurDefinition version={v} />
      ) : (
        <>
          <Alerte tonalite={v.statut === "valide" ? "succes" : "info"} annonce="status">
            <p>
              {v.statut === "valide"
                ? t(
                    "Version validée : elle est figée et peut être envoyée depuis l'onglet « Questionnaires » d'une mission. Pour la faire évoluer, créez une nouvelle version depuis le modèle.",
                    'Approved version: it is locked and can be sent from the "Questionnaires" tab of an engagement. To evolve it, create a new version from the template.',
                  )
                : t(
                    "Brouillon en cours de rédaction : votre rôle permet de le consulter, pas de le modifier.",
                    "Draft being written: your role lets you view it, not edit it.",
                  )}
            </p>
            {v.statut === "valide" && peutGererQuestionnaires(utilisateur.roles) ? (
              <p>
                <Link href={retour.href}>
                  {t(
                    "Aller au modèle pour créer une nouvelle version",
                    "Go to the template to create a new version",
                  )}
                </Link>
              </p>
            ) : null}
          </Alerte>
          <ApercuQuestionnaire definition={v.definition} langue={langue} />
        </>
      )}
    </div>
  );
}
