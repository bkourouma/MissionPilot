import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ApercuMission } from "../../../../../../components/methodes/ApercuMission";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import {
  hrefApercu,
  hrefVersion,
  type Facteur,
  type VersionDetail,
} from "../../../../../../lib/methodes";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Aperçu de la mission", "Engagement preview") };
}

/**
 * Aperçu de la mission générée (STD-11) : la version appliquée à un contexte saisi, avec
 * synthèse chiffrée, étapes, briques, éléments et règles déclenchées. Rien n'est enregistré.
 */
export default async function PageApercuMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("standard.lire");
  const t = await obtenirT();
  const [r, f] = await Promise.all([
    chargerServeur<VersionDetail>(`/api/methodes/versions/${id}`),
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok || !f.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Aperçu de la mission", "Engagement preview")}
          retour={{ href: hrefVersion(id), libelle: t("Version", "Version") }}
        />
        <EtatErreur
          titre={t("L'aperçu n'a pas pu être chargé.", "The preview could not be loaded.")}
          message={!r.ok ? r.message : !f.ok ? f.message : ""}
          hrefReessayer={hrefApercu(id)}
        />
      </div>
    );
  }
  const v = r.donnees;
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Aperçu de la mission générée", "Preview of the generated engagement")}
        retour={{
          href: hrefVersion(id),
          libelle: `${v.methode.libelle} — ${t("version", "version")} ${v.version.version}`,
        }}
        soustitre={t(
          "Voyez la mission que cette version produirait pour un contexte donné : étapes, briques actives, durée type, niveaux de garde et règles déclenchées.",
          "See the engagement this version would produce for a given context: steps, active building blocks, standard duration, safeguard levels and triggered rules.",
        )}
      />
      <ApercuMission
        versionId={id}
        facteurs={f.donnees.elements}
        regles={v.regles.map((x) => ({ code: x.code, libelle: x.regle.libelle }))}
      />
    </div>
  );
}
