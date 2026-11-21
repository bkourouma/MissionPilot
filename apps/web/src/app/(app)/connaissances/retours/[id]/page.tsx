import Link from "next/link";
import type { Metadata } from "next";
import { SECTIONS_RETOUR } from "@missionpilot/shared";
import {
  ActionsRetour,
  FormulaireVersionRetour,
} from "../../../../../components/connaissances/FormulairesConnaissances";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  droitsConnaissances,
  libelleOrigine,
  libelleSection,
  libelleStatutContenu,
  tonaliteStatutRetour,
  type RetourDetail,
  type VersionRetour,
} from "../../../../../lib/capitalisation";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Retour d'expérience", "Lessons learned") };
}

/**
 * Un retour d'expérience (CAP-01) : version courante (brouillon automatique, brouillon IA ou
 * rédaction), historique, et pour le chef ou le directeur de la mission : nouvelle version,
 * rédaction proposée par l'IA, validation. L'API vérifie le rôle sur la mission.
 */
export default async function PageRetour({ params }: { params: Promise<{ id: string }> }) {
  const { utilisateur } = await exigerPermission("connaissance.lire");
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerServeur<RetourDetail>(
    `/api/capitalisation/retours/${encodeURIComponent(id)}`,
  );
  if (!r.ok) {
    return (
      <div className="mp-page mp-connaissances">
        <EnteteDePage
          titre={t("Retour d'expérience", "Lessons learned")}
          retour={{
            href: "/connaissances/retours",
            libelle: t("Retours d'expérience", "Lessons learned"),
          }}
        />
        <EtatErreur
          titre={t(
            "Ce retour d'expérience n'a pas pu être chargé.",
            "This lessons-learned review could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/connaissances/retours/${id}`}
        />
      </div>
    );
  }
  const d = r.donnees;
  const droits = droitsConnaissances(utilisateur.roles);
  const affichee = d.version_validee_contenu ?? d.version_courante;
  const redigeable = d.statut === "brouillon" && droits.rediger;
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={t(
          `Retour d'expérience : ${d.mission.intitule}`,
          `Lessons learned: ${d.mission.intitule}`,
        )}
        soustitre={t(
          `${d.mission.client} · ouvert le ${formaterDate(d.ouvert_le)}`,
          `${d.mission.client} · opened on ${formaterDate(d.ouvert_le, "UTC", langue)}`,
        )}
        retour={{
          href: "/connaissances/retours",
          libelle: t("Retours d'expérience", "Lessons learned"),
        }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutRetour(d.statut)}>
            {d.statut === "valide"
              ? t(
                  `Validé (version ${d.version_validee})`,
                  `Approved (version ${d.version_validee})`,
                )
              : t("Brouillon", "Draft")}
          </BadgeStatut>
        }
        actions={
          <Link
            href={`/connaissances/missions/${d.mission_id}/briques`}
            className={classesBouton("secondaire")}
          >
            {t("Briques des tâches", "Task building blocks")}
          </Link>
        }
      />
      {affichee ? <Version v={affichee} /> : null}
      {redigeable && d.version_courante ? (
        <>
          <Carte titre={t("Valider ou améliorer", "Approve or improve")}>
            <ActionsRetour
              id={d.id}
              version={d.version_courante.version}
              chiffresNonVerifies={d.version_courante.chiffres_non_verifies}
              ia={droits.ia}
            />
          </Carte>
          <Carte titre={t("Rédiger une nouvelle version", "Write a new version")}>
            <FormulaireVersionRetour
              id={d.id}
              initiale={{
                contexte: d.version_courante.contexte,
                methode: d.version_courante.methode,
                ecarts: d.version_courante.ecarts,
                lecons: d.version_courante.lecons,
              }}
            />
          </Carte>
        </>
      ) : null}
      <Carte titre={t("Historique des versions", "Version history")}>
        <ul className="mp-liste-lignes">
          {d.historique.map((h) => (
            <li key={h.version} className="mp-liste-lignes__ligne">
              <span>
                {`${t("Version", "Version")} ${h.version} · ${libelleOrigine(h.origine, langue)}`}
                <span className="mp-texte-doux mp-texte-petit">
                  {` · ${h.cree_par_nom ?? "—"} · ${formaterDate(h.cree_le, "UTC", langue)}`}
                </span>
              </span>
              <BadgeStatut tonalite={h.statut_contenu === "valide" ? "succes" : "neutre"}>
                {libelleStatutContenu(h.statut_contenu, langue)}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}

async function Version({ v }: { v: VersionRetour }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Carte
      titre={`Version ${v.version} · ${libelleOrigine(v.origine, langue)}`}
      actions={
        <BadgeStatut tonalite="neutre">
          {libelleStatutContenu(v.statut_contenu, langue)}
        </BadgeStatut>
      }
    >
      {v.chiffres_non_verifies ? (
        <Alerte tonalite="attention" titre={t("Nombres à vérifier", "Numbers to check")}>
          <p>
            {t(
              "Des nombres de cette rédaction ne viennent pas des moteurs de calcul : relisez-les avant de valider.",
              "Some numbers in this draft do not come from the calculation engines: review them before approving.",
            )}
          </p>
        </Alerte>
      ) : null}
      <dl className="mp-liste-def">
        {SECTIONS_RETOUR.map((k) => (
          <div key={k}>
            <dt>{libelleSection(k, langue)}</dt>
            <dd className="mp-connaissances__section">{v[k]}</dd>
          </div>
        ))}
      </dl>
    </Carte>
  );
}
