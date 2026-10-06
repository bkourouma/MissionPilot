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
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  libelleStatut,
  peutGererQuestionnaires,
  STATUT_VERSION,
  type VersionDetail,
} from "../../../../../lib/questionnaires";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Version de questionnaire" };

/**
 * Version d'un modèle de questionnaire : éditeur si c'est un brouillon et que l'utilisateur
 * rédige (`questionnaire.gerer`), aperçu en lecture seule sinon (version validée = figée).
 */
export default async function PageVersion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("questionnaire.lire");
  const r = await chargerServeur<VersionDetail>(`/api/questionnaires/versions/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Version de questionnaire"
          retour={{ href: "/questionnaires", libelle: "Questionnaires" }}
        />
        <EtatErreur
          titre="La version n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/questionnaires/versions/${id}`}
        />
      </div>
    );
  }
  const v = r.donnees;
  const statut = libelleStatut(STATUT_VERSION, v.statut);
  const editable = v.statut === "brouillon" && peutGererQuestionnaires(utilisateur.roles);
  const retour = { href: `/questionnaires/${v.modele_id}`, libelle: "Modèle et versions" };

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={v.definition.titre}
        retour={retour}
        soustitre={`Code ${v.code} · version ${v.version} · ${
          v.statut === "valide" && v.valide_le
            ? `validée le ${formaterDateHeure(v.valide_le)}`
            : `modifiée le ${formaterDateHeure(v.modifie_le)}`
        }`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />
      {editable ? (
        <EditeurDefinition version={v} />
      ) : (
        <>
          <Alerte tonalite={v.statut === "valide" ? "succes" : "info"} annonce="status">
            <p>
              {v.statut === "valide"
                ? "Version validée : elle est figée et peut être envoyée depuis l'onglet « Questionnaires » d'une mission. Pour la faire évoluer, créez une nouvelle version depuis le modèle."
                : "Brouillon en cours de rédaction : votre rôle permet de le consulter, pas de le modifier."}
            </p>
            {v.statut === "valide" && peutGererQuestionnaires(utilisateur.roles) ? (
              <p>
                <Link href={retour.href}>Aller au modèle pour créer une nouvelle version</Link>
              </p>
            ) : null}
          </Alerte>
          <ApercuQuestionnaire definition={v.definition} />
        </>
      )}
    </div>
  );
}
